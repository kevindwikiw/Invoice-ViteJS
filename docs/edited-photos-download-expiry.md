# Edited Photos Download Expiry

## Tujuan

Admin dapat menentukan berapa lama client boleh membuka Edited Photos melalui aplikasi Orbit. Batas ini terpisah dari masa berlaku culling gallery.

Pilihan yang tersedia:

- 24 hours
- 3 days
- 7 days (default)
- 14 days
- Custom (1–3650 days)
- Unlimited

## Alur Admin

1. Pilih duration di **Edited Photos Delivery**.
2. Tekan **Save changes** untuk menyimpan konfigurasi draft.
3. Masukkan password Edited Photos.
4. Tekan **Publish** atau **Republish**.
5. Kirim password baru kepada client.

Expiry dihitung sejak Publish/Republish, bukan sejak Save changes. Republish membuat masa berlaku baru.

## Catatan Keamanan

Expiry membatasi password, token, thumbnail, preview, Before / After, dan metadata melalui aplikasi Orbit. URL Google Drive yang sudah tersebar tetap dapat dibuka selama permission Drive masih `Anyone with the link`.

## Data Lama

Gallery lama tetap kompatibel. Jika belum memiliki konfigurasi duration, publish berikutnya menggunakan default 7 hari. Perubahan duration tidak mengubah selection culling yang sudah ada.

## Checklist

- Pilih duration yang sesuai.
- Save changes sebelum Publish.
- Pastikan folder dan ZIP Drive bisa dibuka lewat incognito.
- Salin password baru setelah Publish/Republish.
- Beri tahu client kapan akses akan berakhir.
