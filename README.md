# FireFighter Leave Board

پنل مرخصی فکشن برای GitHub Pages + Supabase.

## منطق مرخصی

- سهمیه عادی ماهانه هر نفر: ۲۱ ساعت
- روزانه: دقیقاً ۳ ساعت
- ساعتی: ۱ تا ۱۲۰ دقیقه
- روزانه و ساعتی از یک سهمیه مشترک ۲۱ ساعته کم می‌شوند.
- مرخصی اضافه با تأیید لیدر خارج از سهمیه ۲۱ ساعت ثبت می‌شود.
- هنگام ثبت، زمان شروع خودکار از همان لحظه ثبت ساخته می‌شود و زمان پایان بر اساس مدت محاسبه می‌شود.
- شروع و پایان به‌صورت میلادی و شمسی نمایش داده می‌شوند.
- تایمر فعال‌ها هر ثانیه به‌روزرسانی می‌شود.

## امنیت Supabase

این نسخه دیگر حالت local fallback ندارد. اگر Supabase یا Session معتبر وجود نداشته باشد، پنل قفل می‌ماند.

### 1) اجرای Migration

فایل `supabase-security-migration.sql` را یک‌بار در SQL Editor پروژه Supabase اجرا کنید.

این Migration:

- جدول `ff_staff` را برای اتصال کاربران Auth به username و نقش ایجاد می‌کند.
- فقط نقش‌های `leader` و `subleader` را مجاز می‌کند.
- دسترسی `anon` به `leave_manager_state` را حذف می‌کند.
- INSERT/DELETE مستقیم روی `leave_manager_state` را می‌بندد و فقط SELECT/UPDATE روی رکورد id=1 را برای staff فعال می‌کند.
- Realtime جدول را حفظ می‌کند.

### 2) ساخت کاربران ورود

در Supabase بروید به:

`Authentication → Users`

برای هر لیدر/ساب‌لیدر یک User بسازید.

این پروژه برای ورود با «یوزرنیم» به‌صورت داخلی آن را به شکل زیر به Auth می‌فرستد:

`username@firefighter.local`

مثلاً username:

`mahdi`

در Auth باید email آن کاربر باشد:

`mahdi@firefighter.local`

و password را در Auth همان‌جا تعیین کنید.

برای این مدل، ایمیل‌های فرضی هستند و نیازی به دریافت ایمیل واقعی ندارند؛ کاربر را Confirm کنید یا تنظیم Confirm Email را مطابق نیاز پنل خصوصی مدیریت کنید.

### 3) ثبت کاربر در ff_staff

بعد از ساخت Auth User، در Table Editor جدول `ff_staff` یک رکورد بسازید:

- `user_id`: UUID همان User در Authentication → Users
- `username`: مثلاً `mahdi`
- `display_name`: مثلاً `Mahdi`
- `role`: یکی از `leader` یا `subleader`

اگر Auth User ساخته شده ولی در `ff_staff` ثبت نشده باشد، ورود عمداً رد می‌شود.

### 4) بستن Signup عمومی

در تنظیمات Authentication، ثبت‌نام عمومی را خاموش کنید تا فقط Userهایی که خودتان در Dashboard می‌سازید بتوانند وارد شوند.

### 5) Publishable key

فایل `supabase-config.js` فقط باید `sb_publishable_...` داشته باشد. هرگز Secret/Service Role key را داخل GitHub Pages قرار ندهید.

## استقرار

فایل‌ها را در Repository گیت‌هاب قرار دهید و GitHub Pages را روی branch اصلی و root نگه دارید.
