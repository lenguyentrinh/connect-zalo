| Method | Đường dẫn                            | Chức năng                                           |
| ------ | ------------------------------------ | --------------------------------------------------- |
| POST   | `/zalo/login`                        | Bắt đầu đăng nhập bằng QR                           |
| GET    | `/zalo/login/qr`                     | Ảnh QR (mở bằng trình duyệt rồi quét bằng app Zalo) |
| GET    | `/zalo/status`                       | logged_out / waiting_scan / scanned / logged_in     |
| DELETE | `/zalo/login`                        | Hủy đăng nhập đang chờ                              |
| GET    | `/zalo/groups`                       | Danh sách nhóm (id, tên, số thành viên)             |
| GET    | `/zalo/groups/:id/messages?count=50` | Tin nhắn gần nhất của nhóm (tối đa 200)             |
