// One place for "click through to the record" targets (Johan 4 Nov 22:32). Display only.
const q = (v: string) => encodeURIComponent(v);
export const invoiceHref = (id: string) => `/admin/invoices/${q(id)}`;
export const jobHref = (id: string) => `/admin/jobs/${q(id)}`;
export const quoteHref = (id: string) => `/admin/quote-builder?quoteId=${q(id)}`;
export const clientHref = (id: string) => `/admin/customers/${q(id)}`;
export const projectHref = (projectId: string) => `/admin/projects/${q(projectId)}`;
export const houseHref = (projectId: string, houseId: string) => `/admin/projects/${q(projectId)}?house=${q(houseId)}`;
export const supplierDocHref = (docId: string) => `/admin/supplier-docs?doc=${q(docId)}`;
export const supplierHref = (supplierId: string) => `/admin/suppliers?supplier=${q(supplierId)}`;
