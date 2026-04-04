# 🤖 Content Bot v2.0 (Family Guy Edition)

Bot tự động tải video (YouTube, Instagram), xử lý video (che logo, chèn khung), tạo caption bằng AI và đăng bài lên X (Twitter).

## 🚀 Tính năng nổi bật
- **Video Masking:** Tự động che logo kênh cũ và chèn khung thương hiệu `@0xFly_`.
- **AI Caption:** Tạo nội dung "mặn" theo phong cách Family Guy và ngôn ngữ viral trên X.
- **Shadowban Monitor:** Tự động kiểm tra trạng thái tài khoản và kích hoạt **Safe Mode** khi bị ban.
- **Random Delay:** Đăng bài ngẫu nhiên để tránh bị X quét spam.
- **Text-only Posts:** Xen kẽ các bài đăng văn bản "vô tri" để tăng tương tác tự nhiên.

## 🛠️ Yêu cầu hệ thống
- **Node.js:** v18 trở lên
- **FFmpeg:** v4.x trở lên (Khuyên dùng v6.x)
- **yt-dlp:** Bản mới nhất
- **PM2:** Để chạy ngầm 24/7

## 📥 Hướng dẫn cài đặt trên VPS

### 1. Cài đặt công cụ hỗ trợ
```bash
sudo apt update
sudo apt install -y ffmpeg
sudo pip install yt-dlp
sudo npm install -g pm2
```

### 2. Cài đặt dự án
```bash
git clone https://github.com/laviephung/concecXXX-v2.git
cd concecXXX-v2
npm install
```

### 3. Cấu hình biến môi trường
```bash
cp .env.example .env
nano .env
# Điền các API Key của Telegram, OpenAI và Twitter vào đây
```

### 4. Khởi tạo Database
```bash
npx prisma generate
npx prisma db push
```

### 5. Chạy Bot
```bash
# Chạy thử nghiệm
npm run dev

# Chạy ngầm bằng PM2
pm2 start npm --name "content-bot-v2" -- run start
pm2 save
pm2 startup
```

## 🔄 Cách cập nhật Bot (Lệnh Update)
Mỗi khi có bản cập nhật mới từ GitHub, anh chỉ cần chạy lệnh sau:
```bash
chmod +x update.sh
./update.sh
```

## 🤖 Các lệnh Telegram Bot
- `/status` - Thống kê kho video + dung lượng
- `/checkban` - Kiểm tra Shadowban @0xFly_ 🛡️
- `/queue` - Xem hàng đợi chờ đăng
- `/postnow` - Đăng 1 video ngay lập tức
- `/crawlnow` - Tải batch video ngay bây giờ
- `/pause` / `/resume` - Tạm dừng/Bật lại đăng bài
- `/retry` - Thử lại các video bị lỗi
