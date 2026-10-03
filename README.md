# Tumeni

Tumeni is a shopping, delivery and task/request platform. The existing React/Vite mobile UI is preserved as the customer-facing visual foundation.

## Current foundation

- React + Vite customer application
- Purchase and task order data model 
- Customers, shops, products, categories and addresses
- Orders and order items
- Payments and payment references
- Pricing rules
- Task requests with AI interpretation storage
- Agent/order assignment model
- Supabase authentication/database integration points

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run supabase/schema.sql.
3. Copy .env.example to .env.local.
4. Add the project's URL and anon key.
5. Run npm install and npm run dev.

The app intentionally keeps its existing visual prototype fallback when Supabase is not configured. Once the environment variables are supplied, database-backed features can be enabled without replacing the customer UI.

## Architecture

Customer UI -> application services -> Supabase -> operational data.

AI should interpret customer task requests and return structured requirements. Pricing rules remain application/database rules; AI does not independently decide the final charge.

## Planned next integration

- Real product/shop loading into the existing screens
- Real customer authentication
- Saved addresses
- Purchase order creation
- Payment gateway/webhook
- Task quote flow
- Admin, partner and agent applications

<!-- Deployment trigger: harmless README refresh. -->
<!-- Deployment trigger: keeps the main deployment pipeline active. -->
<!-- Sync verification trigger: no application code change. -->
