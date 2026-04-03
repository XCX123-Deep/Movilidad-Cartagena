// api/middleware.js — Verificación de tokens Firebase Auth
import admin from 'firebase-admin';

let initialized = false;

function initFirebaseAdmin() {
  if (initialized || admin.apps.length > 0) return;
  
  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  if (serviceAccountEnv) {
    // En Vercel: variable de entorno con el JSON del service account
    const serviceAccount = JSON.parse(
      Buffer.from(serviceAccountEnv, 'base64').toString('utf8')
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // En desarrollo local: usar application default credentials o el archivo
    admin.initializeApp({
      projectId: 'gen-lang-client-0668905089',
    });
  }
  
  initialized = true;
}

/**
 * Middleware: verifica que el token de Firebase Auth sea válido.
 * Agrega req.user con { uid, email, role } si es válido.
 */
export async function requireAuth(req, res, next) {
  try {
    initFirebaseAdmin();
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No autorizado: token ausente' });
    }
    
    const token = authHeader.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ error: 'No autorizado: token inválido' });
  }
}

/**
 * Middleware: verifica que el usuario tenga rol admin o super_admin en MongoDB.
 */
export async function requireAdmin(req, res, next) {
  const { User } = await import('./db.js');
  const userDoc = await User.findOne({ uid: req.firebaseUser.uid });
  
  if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'super_admin')) {
    // También acepta el super_admin hardcodeado
    if (req.firebaseUser.email !== 'juniorborre011@gmail.com') {
      return res.status(403).json({ error: 'Prohibido: se requiere rol de administrador' });
    }
  }
  next();
}
