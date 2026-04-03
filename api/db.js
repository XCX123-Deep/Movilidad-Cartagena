// api/db.js — Conexión a MongoDB con caché de conexión (patrón Vercel)
import mongoose from 'mongoose';

let cached = global._mongooseCache;

if (!cached) {
  cached = global._mongooseCache = { conn: null, promise: null };
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI no está definida en las variables de entorno');
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, {
      bufferCommands: false,
    }).then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ─── Esquema de Usuarios ───────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  uid:         { type: String, required: true, unique: true },
  displayName: { type: String, default: 'Usuario' },
  email:       { type: String, required: true },
  photoURL:    { type: String, default: '' },
  role:        { type: String, enum: ['user', 'admin', 'super_admin'], default: 'user' },
  status:      { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
  karma:       { type: Number, default: 0 },
  sessionId:   { type: String, default: '' },
  createdAt:   { type: String, default: () => new Date().toISOString() },
}, { _id: false }); // usamos uid como identificador principal

export const User = mongoose.models.User || mongoose.model('User', userSchema);

// ─── Esquema de Reportes ───────────────────────────────────────────────────
const reportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['transit_checkpoint', 'police_presence', 'traffic_flow'],
    required: true
  },
  location: {
    latitude:  { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  description:   { type: String, default: '' },
  reporterUid:   { type: String, required: true },
  reporterName:  { type: String, default: 'Usuario' },
  reporterKarma: { type: Number, default: 0 },
  timestamp:     { type: Date, default: Date.now },
  expiresAt:     { type: Date, required: true },
  status:        { type: String, enum: ['active', 'resolved', 'expired'], default: 'active' },
  confirmations: { type: [String], default: [] },
  dismissals:    { type: [String], default: [] },
});

export const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);
