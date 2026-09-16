# API Integration Requirement

Arsitektur yang disarankan: Browser → Backend/API Gateway → Source System.

| Integration | Minimum input | Expected response | Fallback |
|---|---|---|---|
| Flight Schedule | flight, route, station, scan time | date, STD, ETD, status, capacity | Master Flight/manual review |
| Passenger List | flight, Date of Travel, passenger identity | passenger match and cabin | BO verification |
| GarudaMiles | member number, passenger name | masked number, tier, active status, expiry | HO Ancillary verification |
| EMD | EMD number, passenger, flight | service code, coupon status, redemption | HO Ancillary verification |
| Payment | transaction reference | amount, currency, paid status | evidence/manual verification |
| Corporate Identity | user identity | role, station scope, email | controlled local account for UAT only |
| Notification | recipient, event, deep link | delivery status | application inbox |
| Document Storage | evidence/PDF metadata and file | immutable file reference | pending upload state |

API credential tidak boleh disimpan pada browser atau source repository. Semua authorization dan scope station wajib divalidasi kembali di server.
