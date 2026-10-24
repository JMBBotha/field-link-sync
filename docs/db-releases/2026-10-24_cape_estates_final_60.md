# 2026-10-24 Cape Estates final-payment default (data change, approved by Johan 08:49)
UPDATE customers SET final_after_days = 60 WHERE id = '3dde87f5-60cf-5cda-bc54-edd8b0e553cc'; -- CAPE ESTATES PAARL (Pty) Ltd, Massair CT
Per-invoice override still allowed (up to 90 via the Expected payments dialog). No invoice amounts changed.
Rollback: UPDATE customers SET final_after_days = NULL WHERE id = '3dde87f5-60cf-5cda-bc54-edd8b0e553cc';
