import Dexie, { Table } from 'dexie';

// Types for offline storage
export interface OfflineLead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  agreement_id?: string | null;
  scheduled_date?: string | null;
  broadcast_radius_km?: number | null;
  cachedAt: number; // Timestamp when cached
}

export interface OfflineCustomer {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  cachedAt: number;
}

export interface OfflineEquipment {
  id: string;
  customer_id: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  location?: string | null;
  notes?: string | null;
  install_date?: string | null;
  warranty_expiry?: string | null;
  last_service_date?: string | null;
  cachedAt: number;
}

export interface OfflineInvoice {
  id: string;
  lead_id: string;
  agent_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  line_items: any[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  payment_method?: string | null;
  notes?: string | null;
  status: string;
  invoice_number?: string | null;
  cachedAt: number;
}

export interface OfflinePhoto {
  id: string;
  leadId: string;
  base64Data: string;  // Temporary local storage
  fileName: string;
  mimeType: string;
  caption?: string | null;
  photoType: 'before' | 'after';
  capturedAt: number;
  uploaded: boolean;
  markedForDeletion?: boolean;
}

export interface OfflineTimerLog {
  id: string;
  leadId: string;
  startedAt: number;
  pausedAt: number | null;
  totalElapsedMs: number;
  lastUpdatedAt: number;
  synced: boolean;
}

export interface OfflineAvailability {
  id: string;
  agentId: string;
  isAvailable: boolean;
  latitude: number;
  longitude: number;
  updatedAt: number;
  synced: boolean;
}

export type OperationType = 
  | 'update_lead' 
  | 'update_job_status'
  | 'create_invoice' 
  | 'update_invoice' 
  | 'update_equipment'
  | 'update_agent_location'
  | 'upload_photo'
  | 'delete_photo'
  | 'update_timer_log';

export interface PendingOperation {
  id?: number; // Auto-increment
  operationType: OperationType;
  tableName: string;
  recordId: string;
  data: any;
  timestamp: number;
  retryCount: number;
  lastError?: string | null;
  synced: boolean;
}

export interface SyncMeta {
  key: string;
  value: any;
}

// IndexedDB Database using Dexie
class OfflineDatabase extends Dexie {
  leads!: Table<OfflineLead, string>;
  customers!: Table<OfflineCustomer, string>;
  equipment!: Table<OfflineEquipment, string>;
  invoices!: Table<OfflineInvoice, string>;
  photos!: Table<OfflinePhoto, string>;
  timerLogs!: Table<OfflineTimerLog, string>;
  availability!: Table<OfflineAvailability, string>;
  pendingOperations!: Table<PendingOperation, number>;
  syncMeta!: Table<SyncMeta, string>;

  constructor() {
    super('FieldAgentOfflineDB');
    
    // Version 2: Add photos, timerLogs, availability tables
    this.version(2).stores({
      leads: 'id, status, assigned_agent_id, customer_id, cachedAt',
      customers: 'id, name, cachedAt',
      equipment: 'id, customer_id, cachedAt',
      invoices: 'id, lead_id, agent_id, status, cachedAt',
      photos: 'id, leadId, uploaded, capturedAt',
      timerLogs: 'id, leadId, synced',
      availability: 'id, agentId, synced',
      pendingOperations: '++id, operationType, tableName, recordId, timestamp, synced',
      syncMeta: 'key'
    });

    // Upgrade from version 1
    this.version(1).stores({
      leads: 'id, status, assigned_agent_id, customer_id, cachedAt',
      customers: 'id, name, cachedAt',
      equipment: 'id, customer_id, cachedAt',
      invoices: 'id, lead_id, agent_id, status, cachedAt',
      pendingOperations: '++id, operationType, tableName, recordId, timestamp, synced',
      syncMeta: 'key'
    });
  }

  // Cache jobs for current agent
  async cacheLeads(leads: any[], agentId: string) {
    const now = Date.now();
    const offlineLeads: OfflineLead[] = leads.map(lead => ({
      ...lead,
      cachedAt: now
    }));

    await this.transaction('rw', this.leads, async () => {
      // Clear old leads for this agent or unassigned
      const existingIds = await this.leads.toCollection().primaryKeys();
      if (existingIds.length > 0) {
        await this.leads.bulkDelete(existingIds);
      }
      // Add fresh leads
      await this.leads.bulkPut(offlineLeads);
    });

    // Update last sync time
    await this.syncMeta.put({ key: 'lastLeadsSync', value: now });
  }

  // Cache customers related to agent's leads
  async cacheCustomers(customers: any[]) {
    const now = Date.now();
    const offlineCustomers: OfflineCustomer[] = customers.map(c => ({
      ...c,
      cachedAt: now
    }));
    await this.customers.bulkPut(offlineCustomers);
  }

  // Cache equipment related to agent's leads
  async cacheEquipment(equipment: any[]) {
    const now = Date.now();
    const offlineEquipment: OfflineEquipment[] = equipment.map(e => ({
      ...e,
      cachedAt: now
    }));
    await this.equipment.bulkPut(offlineEquipment);
  }

  // Get cached leads
  async getCachedLeads(): Promise<OfflineLead[]> {
    return this.leads.toArray();
  }

  // Get cached customers
  async getCachedCustomers(): Promise<OfflineCustomer[]> {
    return this.customers.toArray();
  }

  // Get cached equipment
  async getCachedEquipment(): Promise<OfflineEquipment[]> {
    return this.equipment.toArray();
  }

  // === Photo Operations ===
  async savePhoto(photo: Omit<OfflinePhoto, 'uploaded'>): Promise<string> {
    const offlinePhoto: OfflinePhoto = {
      ...photo,
      uploaded: false
    };
    await this.photos.put(offlinePhoto);
    return photo.id;
  }

  async getPhotosForLead(leadId: string): Promise<OfflinePhoto[]> {
    return this.photos.where('leadId').equals(leadId).toArray();
  }

  async getPendingPhotos(): Promise<OfflinePhoto[]> {
    return this.photos.filter(p => !p.uploaded).toArray();
  }

  async markPhotoUploaded(photoId: string): Promise<void> {
    await this.photos.update(photoId, { uploaded: true });
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.photos.delete(photoId);
  }

  // === Timer Log Operations ===
  async saveTimerLog(log: OfflineTimerLog): Promise<void> {
    await this.timerLogs.put(log);
  }

  async getTimerLogForLead(leadId: string): Promise<OfflineTimerLog | undefined> {
    return this.timerLogs.where('leadId').equals(leadId).first();
  }

  async getPendingTimerLogs(): Promise<OfflineTimerLog[]> {
    return this.timerLogs.filter(log => !log.synced).toArray();
  }

  async markTimerLogSynced(logId: string): Promise<void> {
    await this.timerLogs.update(logId, { synced: true });
  }

  // === Availability Operations ===
  async saveAvailability(availability: OfflineAvailability): Promise<void> {
    await this.availability.put(availability);
  }

  async getLatestAvailability(agentId: string): Promise<OfflineAvailability | undefined> {
    return this.availability.where('agentId').equals(agentId).first();
  }

  async getPendingAvailability(): Promise<OfflineAvailability[]> {
    return this.availability.filter(a => !a.synced).toArray();
  }

  async markAvailabilitySynced(id: string): Promise<void> {
    await this.availability.update(id, { synced: true });
  }

  // Queue a pending operation
  async queueOperation(operation: Omit<PendingOperation, 'id' | 'retryCount' | 'synced'>) {
    await this.pendingOperations.add({
      ...operation,
      retryCount: 0,
      synced: false
    });
  }

  // Get all pending (unsynced) operations
  async getPendingOperations(): Promise<PendingOperation[]> {
    return this.pendingOperations
      .filter(op => !op.synced)
      .sortBy('timestamp');
  }

  // Get pending operations by type
  async getPendingOperationsByType(): Promise<Record<OperationType, number>> {
    const pending = await this.getPendingOperations();
    const counts: Record<OperationType, number> = {
      update_lead: 0,
      update_job_status: 0,
      create_invoice: 0,
      update_invoice: 0,
      update_equipment: 0,
      update_agent_location: 0,
      upload_photo: 0,
      delete_photo: 0,
      update_timer_log: 0,
    };
    
    pending.forEach(op => {
      if (counts[op.operationType] !== undefined) {
        counts[op.operationType]++;
      }
    });
    
    return counts;
  }

  // Get failed operations (retryCount > 0)
  async getFailedOperations(): Promise<PendingOperation[]> {
    return this.pendingOperations
      .filter(op => !op.synced && op.retryCount > 0)
      .toArray();
  }

  // Mark operation as synced
  async markOperationSynced(id: number) {
    await this.pendingOperations.update(id, { synced: true });
  }

  // Update operation with error
  async updateOperationError(id: number, error: string) {
    const op = await this.pendingOperations.get(id);
    if (op) {
      await this.pendingOperations.update(id, {
        retryCount: op.retryCount + 1,
        lastError: error
      });
    }
  }

  // Delete a specific pending operation
  async deleteOperation(id: number): Promise<void> {
    await this.pendingOperations.delete(id);
  }

  // Clear all failed operations
  async clearFailedOperations(): Promise<number> {
    const failed = await this.getFailedOperations();
    const ids = failed.map(op => op.id!).filter(id => id !== undefined);
    await this.pendingOperations.bulkDelete(ids);
    return ids.length;
  }

  // Delete synced operations older than 24 hours
  async cleanupSyncedOperations() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const oldSyncedOps = await this.pendingOperations
      .filter(op => op.synced && op.timestamp < cutoff)
      .toArray();
    
    if (oldSyncedOps.length > 0) {
      await this.pendingOperations.bulkDelete(oldSyncedOps.map(op => op.id!));
    }
  }

  // Update a lead locally (optimistic update)
  async updateLeadLocally(leadId: string, updates: Partial<OfflineLead>) {
    const lead = await this.leads.get(leadId);
    if (lead) {
      await this.leads.update(leadId, { ...updates, cachedAt: Date.now() });
    }
  }

  // Get pending operation count
  async getPendingCount(): Promise<number> {
    return this.pendingOperations.filter(op => !op.synced).count();
  }

  // Get last sync time
  async getLastSyncTime(): Promise<number | null> {
    const meta = await this.syncMeta.get('lastLeadsSync');
    return meta?.value || null;
  }

  // Clear all cached data
  async clearAllCache() {
    await Promise.all([
      this.leads.clear(),
      this.customers.clear(),
      this.equipment.clear(),
      this.invoices.clear(),
      this.photos.clear(),
      this.timerLogs.clear(),
      this.availability.clear(),
    ]);
  }

  // Clear everything including pending operations
  async clearEverything() {
    await Promise.all([
      this.clearAllCache(),
      this.pendingOperations.clear(),
      this.syncMeta.clear(),
    ]);
  }
}

// Singleton instance
export const offlineDb = new OfflineDatabase();
