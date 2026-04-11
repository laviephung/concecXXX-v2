#!/bin/bash

# Script tá»± Ä‘á»™ng cáº­p nháº­t Bot v2.0 cho VPS
# CÃ¡ch dÃ¹ng: chmod +x update.sh && ./update.sh

echo "ðŸš€ Báº¯t Ä‘áº§u cáº­p nháº­t Bot v2.0..."

# 1. KÃ©o code má»›i nháº¥t tá»« GitHub
echo "ðŸ“¥ Äang kÃ©o code má»›i nháº¥t tá»« GitHub..."
git pull origin main

# 3. Cáº­p nháº­t Database (náº¿u cÃ³ thay Ä‘á»•i Schema)
echo "ðŸ—„ï¸ Äang cáº­p nháº­t Database..."
npx prisma generate
npx prisma db push

# 4. Khá»Ÿi Ä‘á»™ng láº¡i Bot trÃªn PM2
echo "ðŸ”„ Äang khá»Ÿi Ä‘á»™ng láº¡i Bot trÃªn PM2..."
npm run dev
