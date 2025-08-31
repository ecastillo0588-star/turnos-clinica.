// supabaseClient.js
// Cliente único de Supabase (ESM). Respeta exactamente la URL y la anon key usadas en tu código.
// No cambia funcionalidad: solo expone una instancia centralizada para reutilizar en otros módulos.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/** ⚠️ Respeta tus credenciales actuales */
const supabaseUrl = 'https://vwkszvdvswznlgxlfdtz.supabase.co';
const supabaseAnonKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3a3N6dmR2c3d6bmxneGxmZHR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU1NDM4NDQsImV4cCI6MjA3MTExOTg0NH0.TnDGheCSTUqGwTCMiHZ_CUgcAztCqVTc1cINkMud8p0';

/**
 * Para prevenir instancias duplicadas si el bundle importa este módulo más de una vez,
 * usamos un pequeño caché en `globalThis`. Esto NO cambia comportamiento alguno.
 */
const CACHE_KEY = "__EGH_SUPABASE_SINGLETON__";

if (!globalThis[CACHE_KEY]) {
  globalThis[CACHE_KEY] = createClient(supabaseUrl, supabaseAnonKey);
}

/** Instancia única reutilizable en toda la app */
const supabase = globalThis[CACHE_KEY];

export default supabase;

/**
 * Helper opcional por si preferís una función (no cambia nada del flujo actual).
 * Ejemplo de uso futuro: `import { getSupabase } from './supabaseClient.js'`
 */
export function getSupabase() {
  return supabase;
}
