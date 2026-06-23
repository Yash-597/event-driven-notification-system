# AWS Lightsail Deployment

This project can run on one Ubuntu Lightsail instance:

```text
Internet -> Nginx :80 -> Node.js app :3000 -> Redis localhost :6379
                                      -> Resend API
```

## 1. Create Server

Create an AWS Lightsail Ubuntu instance.

Recommended for a demo:

- Ubuntu 22.04 or 24.04
- smallest or second-smallest Lightsail plan
- open only ports `22`, `80`, and later `443`

## 2. Install Runtime

SSH into the instance:

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y git curl nginx redis-server
```

Install Node.js 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2:

```bash
sudo npm install -g pm2
```

## 3. Secure Redis

Edit Redis config:

```bash
sudo nano /etc/redis/redis.conf
```

Make sure Redis is bound to localhost:

```text
bind 127.0.0.1 ::1
protected-mode yes
```

Restart Redis:

```bash
sudo systemctl restart redis-server
sudo systemctl enable redis-server
```

Check Redis:

```bash
redis-cli ping
```

Expected:

```text
PONG
```

## 4. Upload Code

Option A: clone from GitHub:

```bash
cd ~
git clone YOUR_REPO_URL notification-system
cd notification-system/server
```

Option B: upload the folder manually with SCP/SFTP, then:

```bash
cd ~/notification-system/server
```

Install dependencies:

```bash
npm install
```

## 5. Create Environment File

Create `.env` on the server:

```bash
nano .env
```

Use:

```env
RESEND_API_KEY=your_resend_api_key_here
FROM_EMAIL=Notification Demo <onboarding@resend.dev>
PORT=3000
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=100
```

Never commit `.env`.

## 6. Start App With PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then:

```bash
pm2 save
pm2 status
pm2 logs notification-system
```

## 7. Configure Nginx

Create config:

```bash
sudo nano /etc/nginx/sites-available/notification-system
```

Paste:

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/notification-system /etc/nginx/sites-enabled/notification-system
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Open:

```text
http://YOUR_LIGHTSAIL_PUBLIC_IP
```

Health endpoint:

```text
http://YOUR_LIGHTSAIL_PUBLIC_IP/api/health
```

## 8. Useful Commands

Restart app:

```bash
pm2 restart notification-system
```

View logs:

```bash
pm2 logs notification-system
```

Check Redis:

```bash
redis-cli ping
redis-cli XLEN notifications-stream
```

Check Nginx:

```bash
sudo systemctl status nginx
sudo nginx -t
```

## 9. Optional HTTPS

After pointing a domain to the Lightsail IP:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx
```
