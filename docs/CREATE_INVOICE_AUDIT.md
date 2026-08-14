# CreateInvoice Audit

File utama: `client/src/pages/CreateInvoice.tsx`

## Ringkasan

- Ukuran file: sekitar 1.047 baris.
- File menangani terlalu banyak tanggung jawab: form invoice, package cart, payment terms, proof upload, konfigurasi invoice, sequence number, preview draft, edit invoice, mutation, dan layout.
- Tidak ditemukan import atau state yang jelas-jelas unused pada pemeriksaan awal.
- Audit dimulai read-only; perbaikan tahap pertama tercatat di bawah.

## Perbaikan tahap 1

- Sequence `queryFn` sekarang hanya mengambil data; sinkronisasi state dipindahkan ke `useEffect` yang bergantung pada `seqQuery.data`.
- Payload config mutation sekarang memakai `InvoiceConfigPayload`, bukan `any`.
- Form, merge, configuration, cart, payment terms, dan proof state dipindahkan ke `useCreateInvoiceState` agar component page tidak menjadi state container monolitik.
- Handler dan JSX tetap berada di `CreateInvoice.tsx`, sehingga refactor ini tidak mengubah contract child component.
- Typecheck tetap hijau setelah perubahan.

## Temuan prioritas

### P1 — Side effect di dalam `queryFn`

Query sequence mengubah state React langsung dari `queryFn`:

```tsx
setSeqPrefix(data.prefix);
setSeqNext(data.next_value);
setSeqPadding(data.padding);
setConfigLastValue(data.last_value);
```

`queryFn` sebaiknya hanya mengambil dan mengembalikan data. Side effect dipindahkan ke `useEffect` berdasarkan `seqQuery.data`. Ini mencegah state berubah dari jalur fetching dan membuat behavior React Query lebih mudah diprediksi.

### P1 — Terlalu banyak state lokal dalam satu component

State mencakup setidaknya enam domain berbeda:

1. Form client/event.
2. Cart dan merge item.
3. Payment terms dan cashback.
4. Payment proof upload.
5. Invoice configuration/defaults.
6. Sequence, edit mode, preview restore, dan modal visibility.

Refactor berikutnya sebaiknya memindahkan domain ke hooks/components tanpa mengubah API:

- `useInvoiceFormState`
- `useInvoiceConfiguration`
- `useInvoiceProofs`
- `useInvoiceEditor`

### P1 — Tipe `any` pada payload dan edit data

Terlihat pada `_savePayload`, mutation payload, config mutation, dan mapping edit item. Ini membuat perubahan schema tidak terdeteksi TypeScript.

Target refactor: buat tipe `InvoicePayload`, `InvoiceConfigPayload`, dan `EditableInvoiceResponse` di `types/invoice.ts` atau feature folder.

### P2 — `setTimeout(..., 0)` untuk inisialisasi state

Config restore, preview restore, dan edit restore memakai timer nol milidetik. Ini menambah render ekstra dan membuat urutan loading lebih sulit diprediksi. Setelah behavior divalidasi, timer dapat diganti dengan effect langsung atau loader state yang eksplisit.

### P2 — Sequence query selalu stale

`staleTime: 0` pada sequence menyebabkan data dianggap stale setiap kali query berjalan. Untuk halaman create/edit, ini berpotensi menambah request saat mount/focus. Perlu diputuskan apakah sequence harus selalu fresh atau cukup diambil sekali per sesi form.

### P2 — Upload proof berjalan serial

`handleUpload` memproses file satu per satu. Ini lebih aman untuk API, tetapi membuat banyak file terasa lambat. Bisa dipertahankan untuk edit mode atau diberi batas concurrency; jangan langsung memakai `Promise.all` tanpa batas karena upload proof dan kompresi sama-sama berat CPU.

## Hal yang sudah baik

- Package sidebar dan komponen form sudah dipisah ke child component.
- Package/config query memakai `staleTime` dan `gcTime` yang masuk akal.
- React-PDF tidak di-import langsung di file ini.
- Preview draft memakai `sessionStorage`, jadi state tidak hilang saat kembali dari preview.
- `useMemo` sudah dipakai untuk total invoice dan item terpilih.

## Rencana audit berikutnya

1. Audit dependency dan prop boundary `PackageSidebar`, `BillItems`, `PaymentDetails`, dan `PaymentTerms`.
2. Audit semua `useEffect` dan urutan restore create/edit/preview.
3. Ganti tipe `any` dengan payload/response type.
4. Pecah logic menjadi hooks kecil setelah behavior existing tertutup smoke test.
5. Ukur render dan CPU sebelum/sesudah refactor.
