import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Allow Vercel's public Supabase variables in the browser bundle.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
