# Setup Guide — Part 1 (Auth + Database)

## 1. Free Postgres database (Neon)
1. https://neon.tech pe jao, free sign up karo.
2. Naya project banao — "Management Task Pro" naam de do.
3. Connection string copy karo (format: `postgresql://user:pass@host/dbname?sslmode=require`).

## 2. Is code ko GitHub pe daalo
1. GitHub pe naya repo banao (e.g. `management-task-pro`).
2. Ye `mtp-backend` folder us repo me push kar do.

## 3. Vercel pe import karo
1. https://vercel.com pe GitHub se login karo.
2. "Add New → Project" → apna repo select karo → Import.
3. Deploy se pehले "Environment Variables" me ye 4 add karo (`.env.example` dekho):
   - `DATABASE_URL` → Neon se copy kiya hua
   - `JWT_SECRET` → koi bhi random lambi string
   - `BOOTSTRAP_SECRET` → koi bhi random lambi string
   - `RESEND_API_KEY` → resend.com se (email ke liye, agli step me use hoga)
4. Deploy dabao.

## 4. Database tables banao
Apne computer pe (ya Vercel ke "Terminal" se):
```
npm install
DATABASE_URL="<neon-connection-string>" npm run db:push
```
Isse saare tables (users, tasks, attendance, etc.) Neon database me ban jayenge.

## 5. Apna pehla login (Boss) banao
Deploy hone ke baad, ek baar ye call karo (Postman ya terminal se):
```
curl -X POST https://<your-app>.vercel.app/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourPassword123","name":"Vikas Gupta","secret":"<BOOTSTRAP_SECRET value>"}'
```
Ye sirf ek baar chalega — dobara chalane par error dega (security ke liye).

## 6. Test karo
```
curl -X POST https://<your-app>.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourPassword123"}'
```
Agar user object wapas mile → auth working hai. ✅

---
**Ready hai:** login, logout, me, bootstrap (first user).
**Agla step:** Team/Users management (add/edit team members) + Task CRUD.
