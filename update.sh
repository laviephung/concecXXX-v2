#!/bin/bash

# Script tự động cập nhật Bot v2.0 cho VPS
# Cách dùng: chmod +x update.sh && ./update.sh

echo "🚀 Bắt đầu cập nhật Bot v2.0..."

# 1. Kéo code mới nhất từ GitHub
echo "📥 Đang kéo code mới nhất từ GitHub..."
git pull origin main

# 2. Cài đặt thêm thư viện mới (nếu có)
echo "📦 Đang cài đặt các gói thư viện mới..."
npm install

# 3. Cập nhật Database (nếu có thay đổi Schema)
echo "🗄️ Đang cập nhật Database..."
npx prisma generate
npx prisma db push

# 4. Khởi động lại Bot trên PM2
echo "🔄 Đang khởi động lại Bot trên PM2..."
pm2 restart content-bot-v2

echo "✅ Cập nhật hoàn tất! Bot đang chạy bản mới nhất."
pm2 logs content-bot-v2 --lines 20
