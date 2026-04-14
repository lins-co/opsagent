# Deployment Guide — EMO Ops Agent

Split deployment:
- **Frontend** → Vercel (auto-deploy on git push)
- **Backend** → EC2 (Docker + GitHub Actions + Watchtower)

---

## 1. Backend on EC2 (one-time)

### 1.1. Spin up EC2
- Ubuntu 22.04, `t3.medium` minimum (2 vCPU, 4 GB RAM)
- Open port `3000` in security group (or `80/443` if adding Nginx)
- Attach an Elastic IP so the address doesn't change

### 1.2. Run setup script
```bash
ssh -i your-key.pem ubuntu@<EC2_IP> 'bash -s' < backend/deploy/ec2-setup.sh
```

### 1.3. Add GitHub secrets
Repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `EC2_HOST` | EC2 public IP |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Contents of `.pem` file |

### 1.4. Create `.env.production` on EC2
```bash
ssh ubuntu@<EC2_IP>
sudo nano /opt/emo/.env.production
```

Paste from `backend/deploy/.env.production.example`. Fill in:
- `DATABASE_URL` (Neon)
- `MONGO_URI` (MongoDB Atlas)
- `ANTHROPIC_API_KEY`
- `JWT_SECRET` (generate: `openssl rand -hex 32`)
- `FRONTEND_URL=https://your-app.vercel.app` (comma-separate multiple)
- `GOOGLE_CLIENT_ID` if using Google OAuth
- `RESEND_API_KEY` if using email

### 1.5. Copy compose + start
```bash
scp backend/docker-compose.yml ubuntu@<EC2_IP>:/opt/emo/

ssh ubuntu@<EC2_IP>
cd /opt/emo
# Login to GHCR
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u YOUR_GH_USER --password-stdin
docker compose pull backend
docker compose up -d

# Watch for QR code — scan with your WhatsApp once
docker logs -f emo-backend
```

Session persists to the `wa-session` volume. Never scan again unless session expires (~2 weeks idle).

### 1.6. Verify
```bash
curl http://<EC2_IP>:3000/api/health
# {"status":"ok","db":"connected",...}
```

---

## 2. Frontend on Vercel (one-time)

### 2.1. Import repo to Vercel
1. Go to https://vercel.com/new
2. Import your Git repo
3. **Configure Project:**
   - **Framework:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build` (auto-detected)
   - **Output Directory:** `dist` (auto-detected)

### 2.2. Environment variables
Add these in Vercel → Project Settings → Environment Variables:

| Name | Value | Environments |
|---|---|---|
| `VITE_API_URL` | `http://<EC2_IP>:3000` or `https://api.yourdomain.com` | Production, Preview, Development |

If you have multiple environments, set different values per environment.

### 2.3. Deploy
Click **Deploy**. Vercel gives you:
- Production URL: `https://your-app.vercel.app`
- Preview URL per PR/branch

### 2.4. Update backend `FRONTEND_URL`
On EC2:
```bash
sudo nano /opt/emo/.env.production
# Set FRONTEND_URL=https://your-app.vercel.app
docker compose restart backend
```

---

## 3. CI/CD — Fully Automated

### Frontend (Vercel handles it automatically)
- Push to `main` → Vercel deploys to production
- Push to any branch → Vercel creates a preview deployment
- PRs get their own preview URL

### Backend (via GitHub Actions, already set up)
- Push to `main` touching `backend/` → `.github/workflows/deploy-backend.yml` triggers
- Builds Docker image → pushes to GHCR → SSHes to EC2 → `docker compose pull && up -d`
- **Watchtower** on EC2 polls GHCR every 60s as a backup

---

## 4. Going to Production — HTTPS

Mixed HTTP/HTTPS won't work: Vercel is HTTPS, so backend must be HTTPS too.

### Option A: Nginx + Let's Encrypt on EC2
```bash
ssh ubuntu@<EC2_IP>
sudo apt install nginx certbot python3-certbot-nginx -y
sudo certbot --nginx -d api.yourdomain.com
```

Point your DNS `A` record for `api.yourdomain.com` → EC2 IP.

Nginx config (`/etc/nginx/sites-available/api.yourdomain.com`):
```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    # SSL certs added by certbot

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Update Vercel `VITE_API_URL` to `https://api.yourdomain.com`.

### Option B: AWS Application Load Balancer (if multi-instance later)
ALB with ACM cert in front of EC2. More scalable but overkill for one instance.

---

## 5. Day-to-day Operations

### Deploy a backend change
```bash
git push origin main  # touching backend/
# → GitHub Actions builds & deploys automatically
# → Check: https://github.com/<repo>/actions
```

### Deploy a frontend change
```bash
git push origin main  # touching frontend/
# → Vercel deploys automatically
# → Check: https://vercel.com/<project>
```

### Check logs
```bash
ssh ubuntu@<EC2_IP>
docker logs -f emo-backend
```

### Restart backend
```bash
ssh ubuntu@<EC2_IP>
cd /opt/emo && docker compose restart backend
```

### Re-scan WhatsApp QR (if session expired)
```bash
docker logs -f emo-backend   # wait for QR
# scan with phone
```

### Update env vars on EC2
```bash
sudo nano /opt/emo/.env.production
docker compose up -d   # picks up new env
```

---

## 6. Troubleshooting

**Frontend shows "Failed to fetch"**
- `VITE_API_URL` in Vercel points to wrong backend
- Backend CORS blocks Vercel origin — check `FRONTEND_URL` on EC2
- Backend not running — `curl http://<EC2_IP>:3000/api/health`

**Vercel preview deployments blocked by CORS**
- The CORS config auto-allows `*.vercel.app` — make sure backend is updated to latest

**WhatsApp bot silent on EC2**
- `docker logs emo-backend` — look for `WhatsApp connected`
- If QR code shows up, scan it
- If detached frame errors, watchdog should auto-recover

**GitHub Action deploy fails**
- Verify `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` secrets are correct
- Security group allows SSH from GitHub IP ranges (or `0.0.0.0/0` if open)

---

## 7. Cost estimate

| Item | Cost |
|---|---|
| EC2 t3.medium | ~$30/mo |
| Elastic IP (while attached) | Free |
| Neon PostgreSQL | Free tier OK |
| MongoDB Atlas | Free tier OK |
| Vercel Hobby plan | Free |
| Anthropic API (Claude Haiku) | ~$20-50/mo at this scale |
| GHCR (image hosting) | Free |
| Total | **~$50-80/mo** |
