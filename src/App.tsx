import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup,
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  limit
} from './firebase';
import { initializeApp, getApp, getApps, deleteApp } from 'firebase/app';
import firebaseConfig from '../firebase-applet-config.json';
import { getAuth } from 'firebase/auth';
import { User } from 'firebase/auth';
import { increment } from 'firebase/firestore';
import { UserProfile, Report, ReportType } from './types';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { 
  AlertTriangle, 
  ShieldAlert, 
  Clock, 
  MapPin, 
  Plus, 
  LogOut, 
  User as UserIcon,
  Navigation,
  ChevronRight,
  Info,
  CheckCircle2,
  X,
  Ban,
  CheckCircle,
  Trash2,
  Search,
  UserPlus,
  Mic,
  ShieldCheck,
  Users,
  UserMinus,
  Edit2
} from 'lucide-react';

import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import confetti from 'canvas-confetti';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

// Fix Leaflet marker icons
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// --- Context ---
const AuthContext = createContext<{
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  user: null,
  profile: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

const useAuth = () => useContext(AuthContext);

// --- Components ---

const RecenterMap = ({ center }: { center: [number, number] }) => {
  const map = useMapEvents({});
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
};

const MapResizer = () => {
  const map = useMapEvents({});
  useEffect(() => {
    // Llamar invalidateSize varias veces con delays progresivos
    // para garantizar que Leaflet recalcule el tamaño correctamente en móvil
    const timers = [
      setTimeout(() => map.invalidateSize(), 100),
      setTimeout(() => map.invalidateSize(), 300),
      setTimeout(() => map.invalidateSize(), 600),
      setTimeout(() => map.invalidateSize(), 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [map]);
  return null;
};

const ReportSkeleton = () => (
  <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50 animate-pulse">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-slate-200 rounded-xl" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-slate-200 rounded w-3/4" />
        <div className="h-3 bg-slate-200 rounded w-1/2" />
        <div className="h-3 bg-slate-200 rounded w-1/4" />
      </div>
    </div>
  </div>
);

const UserLocationMarker = ({ position }: { position: [number, number] }) => {
  const userIcon = L.divIcon({
    html: `<div class="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>`,
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  return <Marker position={position} icon={userIcon} />;
};

const ReportTypeIcon = ({ type, className }: { type: ReportType, className?: string }) => {
  switch (type) {
    case 'transit_checkpoint':
      return <ShieldAlert className={`text-orange-500 ${className}`} />;
    case 'police_presence':
      return <AlertTriangle className={`text-blue-500 ${className}`} />;
    case 'traffic_flow':
      return <Clock className={`text-red-500 ${className}`} />;
  }
};

const ReportTypeName = (type: ReportType) => {
  switch (type) {
    case 'transit_checkpoint': return 'Retén de Tránsito';
    case 'police_presence': return 'Presencia Policial (Tránsito)';
    case 'traffic_flow': return 'Tráfico Lento';
  }
};

const LocationPicker = ({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) => {
  const [position, setPosition] = useState<[number, number] | null>(null);

  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    },
  });

  return position === null ? null : (
    <Marker position={position} />
  );
};

const UserManagement = ({ currentUser, currentProfile }: { currentUser: User, currentProfile: UserProfile }) => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'user' as const
  });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('email'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => doc.data() as UserProfile));
    });
    return () => unsubscribe();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    let secondaryApp: ReturnType<typeof initializeApp> | null = null;
    try {
      // Reusar o crear la app secundaria para no cerrar sesión del admin actual
      try {
        secondaryApp = getApp('Secondary');
      } catch {
        secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      }
      const secondaryAuth = getAuth(secondaryApp);
      
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newUser.email, newUser.password);
      const createdUser = userCredential.user;

      const newProfile: UserProfile = {
        uid: createdUser.uid,
        displayName: newUser.displayName || 'Usuario',
        email: newUser.email,
        role: newUser.role,
        status: 'active',
        sessionId: '',
        karma: 0
      };

      await setDoc(doc(db, 'users', createdUser.uid), newProfile);
      await secondaryAuth.signOut();
      
      setShowCreateModal(false);
      setNewUser({ email: '', password: '', displayName: '', role: 'user' });
      alert("Usuario creado exitosamente.");
    } catch (error: any) {
      console.error("Error creating user", error);
      alert("Error al crear usuario: " + error.message);
    } finally {
      // Limpiar siempre la app secundaria para evitar memory leak
      if (secondaryApp) {
        try { await deleteApp(secondaryApp); } catch {}
      }
      setCreating(false);
    }
  };

  const toggleUserStatus = async (user: UserProfile) => {
    const newStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      await updateDoc(doc(db, 'users', user.uid), { status: newStatus });
    } catch (error) {
      console.error("Error toggling status", error);
      alert("No tienes permisos para realizar esta acción.");
    }
  };

  const deleteUser = async (user: UserProfile) => {
    if (!confirm(`¿Estás seguro de eliminar a ${user.displayName}?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid));
    } catch (error) {
      console.error("Error deleting user", error);
      alert("No tienes permisos para eliminar a este usuario.");
    }
  };

  const updateUserRole = async (user: UserProfile, newRole: 'user' | 'admin' | 'super_admin') => {
    try {
      await updateDoc(doc(db, 'users', user.uid), { role: newRole });
    } catch (error) {
      console.error("Error updating role", error);
      alert("No tienes permisos para cambiar el rol.");
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => window.location.reload()} 
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
            title="Regresar"
          >
            <ChevronRight className="w-6 h-6 text-slate-400 rotate-180" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h2>
            <p className="text-slate-500">Administra roles y accesos del sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar usuario..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all w-64"
            />
          </div>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100 transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Nuevo Usuario</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Rol</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((u) => (
                <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} className="w-10 h-10 rounded-full border border-slate-200" alt="" />
                      <div>
                        <div className="font-bold text-slate-900">{u.displayName}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <select 
                      value={u.role}
                      onChange={(e) => updateUserRole(u, e.target.value as any)}
                      disabled={
                        (currentProfile.role === 'admin' && u.role === 'super_admin') ||
                        (currentProfile.role === 'admin' && u.role === 'admin' && u.uid !== currentUser.uid)
                      }
                      className="bg-slate-100 border-none rounded-lg px-3 py-1 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="user">Usuario</option>
                      <option value="admin">Admin</option>
                      {currentProfile.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {u.status === 'active' ? 'Activo' : 'Deshabilitado'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => toggleUserStatus(u)}
                        disabled={
                          (currentProfile.role === 'admin' && u.role !== 'user') ||
                          u.uid === currentUser.uid
                        }
                        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          u.status === 'active' 
                            ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        } disabled:opacity-30`}
                      >
                        {u.status === 'active' ? (
                          <><Ban className="w-3 h-3" /> Deshabilitar</>
                        ) : (
                          <><CheckCircle className="w-3 h-3" /> Habilitar</>
                        )}
                      </button>
                      <button 
                        onClick={() => deleteUser(u)}
                        disabled={
                          (currentProfile.role === 'admin' && u.role !== 'user') ||
                          u.uid === currentUser.uid
                        }
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 text-slate-600 hover:bg-red-50 hover:text-red-600 rounded-lg text-xs font-bold transition-all disabled:opacity-30"
                      >
                        <Trash2 className="w-3 h-3" /> Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCreateModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Crear Nuevo Usuario</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-full">
                  <X className="w-5 h-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Nombre Completo</label>
                  <input 
                    type="text" 
                    required
                    value={newUser.displayName}
                    onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Correo Electrónico</label>
                  <input 
                    type="email" 
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Contraseña</label>
                  <input 
                    type="password" 
                    required
                    minLength={6}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Rol</label>
                  <select 
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as any })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="user">Usuario</option>
                    <option value="admin">Administrador</option>
                    {currentProfile.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
                  </select>
                </div>
                <button 
                  type="submit"
                  disabled={creating}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100 disabled:opacity-50"
                >
                  {creating ? 'Creando...' : 'Crear Usuario'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const haptic = (type: 'short' | 'double' | 'error') => {
  if (!('vibrate' in navigator)) return;
  switch (type) {
    case 'short': navigator.vibrate(50); break;
    case 'double': navigator.vibrate([50, 50, 50]); break;
    case 'error': navigator.vibrate([100, 50, 100]); break;
  }
};

// --- Funciones de distancia (módulo-nivel) ---
const deg2rad = (deg: number) => deg * (Math.PI / 180);

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// --- Trfico tipo Waze ---
interface TrafficGroup {
  center: [number, number];
  count: number;
  representative: Report;
}

const groupTrafficReports = (reports: Report[]): TrafficGroup[] => {
  const traffic = reports.filter(
    r => r.type === 'traffic_flow' && r.status === 'active' && r.location?.latitude
  );
  const assigned = new Set<string>();
  const groups: TrafficGroup[] = [];

  traffic.forEach(report => {
    if (assigned.has(report.id)) return;
    const cluster = traffic.filter(r => {
      if (assigned.has(r.id)) return false;
      return getDistance(
        report.location.latitude, report.location.longitude,
        r.location.latitude, r.location.longitude
      ) < 0.3; // 300 metros
    });
    cluster.forEach(r => assigned.add(r.id));
    const avgLat = cluster.reduce((s, r) => s + r.location.latitude, 0) / cluster.length;
    const avgLng = cluster.reduce((s, r) => s + r.location.longitude, 0) / cluster.length;
    groups.push({ center: [avgLat, avgLng], count: cluster.length, representative: cluster[0] });
  });
  return groups;
};

const TrafficCircle = ({ group, onSelect }: { group: TrafficGroup; onSelect: (r: Report) => void; key?: string }) => {
  // Amarillo -> Naranja -> Rojo según intensidad
  const color = group.count >= 5 ? '#DC2626'   // Rojo: tráfico severo
              : group.count >= 3 ? '#EA580C'   // Naranja: tráfico denso
              : group.count >= 2 ? '#F97316'   // Naranja claro
              : '#CA8A04';                      // Amarillo: tráfico moderado
  const radius = Math.min(100 + group.count * 80, 500);
  const fillOpacity = Math.min(0.25 + group.count * 0.06, 0.55);

  return (
    <Circle
      center={group.center}
      radius={radius}
      pathOptions={{
        fillColor: color,
        fillOpacity,
        color,
        weight: 3,
        opacity: 0.85
      }}
      eventHandlers={{
        click: () => {
          haptic('short');
          onSelect(group.representative);
        }
      }}
    />
  );
};

const ReportMarker = ({ report, onConfirm, onSelect }: { report: Report, onConfirm: (id: string, still: boolean) => Promise<void> | void, onSelect: (report: Report) => void, key?: string }) => {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const updateOpacity = () => {
      if (!report.expiresAt) return;
      const now = Date.now();
      const expiry = report.expiresAt.toDate().getTime();
      const remaining = expiry - now;
      
      if (remaining <= 0) {
        setOpacity(0);
      } else {
        // Start fading in the last 15 minutes
        const fadeStart = 15 * 60 * 1000;
        if (remaining < fadeStart) {
          setOpacity(Math.max(0.2, remaining / fadeStart));
        } else {
          setOpacity(1);
        }
      }
    };

    updateOpacity();
    const interval = setInterval(updateOpacity, 30000);
    return () => clearInterval(interval);
  }, [report]);

  if (!report.location?.latitude || !report.location?.longitude) return null;
  if (opacity <= 0 || report.status !== 'active') return null;

  const isVerified = (report.reporterKarma || 0) > 10 || (report.confirmations?.length || 0) >= 3;

  return (
    <Marker 
      position={[report.location.latitude, report.location.longitude]}
      opacity={opacity}
      eventHandlers={{
        click: () => {
          haptic('short');
          onSelect(report);
        }
      }}
    >
    </Marker>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'map' | 'users'>('map');
  const [currentSessionId] = useState(() => crypto.randomUUID());

  const [newReport, setNewReport] = useState<{
    type: ReportType;
    description: string;
    latitude: number | null;
    longitude: number | null;
  }>({
    type: 'transit_checkpoint',
    description: '',
    latitude: null,
    longitude: null,
  });
  const [userLocation, setUserLocation] = useState<[number, number]>([10.391, -75.479]); // Cartagena Default
  const [previousLocation, setPreviousLocation] = useState<[number, number] | null>(null);
  const startYRef = React.useRef(0);
  const [approachingReport, setApproachingReport] = useState<Report | null>(null);
  const [approachingTrafficZone, setApproachingTrafficZone] = useState<TrafficGroup | null>(null);

  // Refs de cooldown: guardan qué reportes/zonas ya se alertaron
  // Se resetean cuando el usuario se aleja >1km del punto
  const shownReportsRef = React.useRef<Map<string, number>>(new Map()); // id -> timestamp
  const shownTrafficRef = React.useRef<Map<string, number>>(new Map()); // zoneKey -> timestamp
  const ALERT_COOLDOWN = 5 * 60 * 1000; // 5 min antes de re-alertar la misma zona

  // Auto-dismiss del radar a los 5 segundos
  useEffect(() => {
    if (!approachingReport) return;
    const t = setTimeout(() => setApproachingReport(null), 5000);
    return () => clearTimeout(t);
  }, [approachingReport]);

  // Auto-dismiss de la alerta de tráfico a los 5 segundos
  useEffect(() => {
    if (!approachingTrafficZone) return;
    const t = setTimeout(() => setApproachingTrafficZone(null), 5000);
    return () => clearTimeout(t);
  }, [approachingTrafficZone]);

  const [showConfirmSheet, setShowConfirmSheet] = useState<Report | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<Partial<Report>[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [historicalReports, setHistoricalReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [debouncedReports, setDebouncedReports] = useState<Report[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);

  // Debounce reports update on map move
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedReports(reports);
    }, 300);
    return () => clearTimeout(timer);
  }, [reports]);

  // Handle App Visibility for WebSockets (onSnapshot)
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const setupListeners = () => {
      if (!user || activeTab !== 'map') return;
      
      const q = query(
        collection(db, 'reports'),
        where('status', '==', 'active'),
        orderBy('timestamp', 'desc')
      );

      unsubscribe = onSnapshot(q, (snapshot) => {
        const reportsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Report[];
        setReports(reportsData);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setupListeners();
      } else {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    };

    setupListeners();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      if (unsubscribe) unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, activeTab]);

  useEffect(() => {
    // Retention: Welcome back check
    const lastVisit = localStorage.getItem('lastVisit');
    const now = Date.now();
    if (lastVisit) {
      const daysSince = (now - parseInt(lastVisit)) / (1000 * 60 * 60 * 24);
      if (daysSince > 3) {
        setShowWelcomeBack(true);
        setTimeout(() => setShowWelcomeBack(false), 5000);
      }
    }
    localStorage.setItem('lastVisit', now.toString());
  }, []);

  useEffect(() => {
    // Safety timeout for loading state
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      clearTimeout(timeout);
      try {
        if (user) {
          // Check if user exists and set session
          const userRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            if (data.status === 'disabled') {
              alert("Tu cuenta ha sido deshabilitada.");
              await signOut(auth);
              setLoading(false);
              return;
            }
            
            // Auto-upgrade owner email to super_admin if needed
            if (user.email === "juniorborre011@gmail.com" && data.role !== 'super_admin') {
              await updateDoc(userRef, { role: 'super_admin' });
            }

            // Update session ID
            await updateDoc(userRef, { sessionId: currentSessionId });
          } else {
            // Create new user
            const isOwnerEmail = user.email === "juniorborre011@gmail.com";
            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'Usuario',
              email: user.email || '',
              photoURL: user.photoURL || '',
              role: isOwnerEmail ? 'super_admin' : 'user',
              status: 'active',
              sessionId: currentSessionId,
              karma: 0
            };
            await setDoc(userRef, newProfile);
          }
          setUser(user);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (error) {
        console.error("Auth state change error:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [currentSessionId]);

  // Get user location and handle proximity
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const newLoc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setPreviousLocation(userLocation);
          setUserLocation(newLoc);
          
          // Radar de Proximidad - con cooldown para no repetir alertas
          if (reports.length > 0) {
            const now = Date.now();

            // --- Retenes / Policia ---
            reports.forEach(report => {
              if (report.status !== 'active' || report.type === 'traffic_flow') return;
              if (!report.location?.latitude) return;

              const dist = getDistance(newLoc[0], newLoc[1], report.location.latitude, report.location.longitude);

              // Resetear cooldown cuando el usuario se aleja >1km
              if (dist > 1.0) {
                shownReportsRef.current.delete(report.id);
              }

              // Alerta de proximidad (800m) - solo si no se alertó recientemente
              if (dist < 0.8 && dist > 0.1 && previousLocation) {
                const prevDist = getDistance(previousLocation[0], previousLocation[1], report.location.latitude, report.location.longitude);
                const lastShown = shownReportsRef.current.get(report.id) || 0;
                if (dist < prevDist && (now - lastShown) > ALERT_COOLDOWN) {
                  shownReportsRef.current.set(report.id, now);
                  setApproachingReport(report);
                  if ('vibrate' in navigator) navigator.vibrate(200);
                }
              }

              // Confirmación al pasar (100m)
              if (dist < 0.1) {
                setShowConfirmSheet(report);
              } else if (dist > 0.2) {
                if (showConfirmSheet?.id === report.id) setShowConfirmSheet(null);
              }
            });

            // --- Zonas de tráfico (600m) con cooldown ---
            const trafficGroups = groupTrafficReports(reports);
            trafficGroups.forEach(group => {
              const zoneKey = `${group.center[0].toFixed(3)},${group.center[1].toFixed(3)}`;
              const dist = getDistance(newLoc[0], newLoc[1], group.center[0], group.center[1]);

              // Resetear cooldown cuando se aleja >1km
              if (dist > 1.0) {
                shownTrafficRef.current.delete(zoneKey);
              }

              if (dist < 0.6 && dist > 0.05 && previousLocation) {
                const prevDist = getDistance(previousLocation[0], previousLocation[1], group.center[0], group.center[1]);
                const lastShown = shownTrafficRef.current.get(zoneKey) || 0;
                if (dist < prevDist && (now - lastShown) > ALERT_COOLDOWN) {
                  shownTrafficRef.current.set(zoneKey, now);
                  setApproachingTrafficZone(group);
                  if ('vibrate' in navigator) navigator.vibrate([80, 60, 80]);
                }
              }
            });
          }
        },
        () => console.log("Geolocation denied"),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [reports, previousLocation, showConfirmSheet]);

  // Offline Sync
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      if (offlineQueue.length > 0) {
        offlineQueue.forEach(async (report) => {
          try {
            await addDoc(collection(db, 'reports'), {
              ...report,
              timestamp: serverTimestamp(),
              expiresAt: Timestamp.fromMillis(Date.now() + 45 * 60 * 1000)
            });
          } catch (e) {
            console.error("Sync error", e);
          }
        });
        setOfflineQueue([]);
        alert("Reportes sincronizados exitosamente.");
      }
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [offlineQueue]);

  // getDistance y deg2rad ahora son funciones de módulo (ver arriba)

  const startVoiceReporting = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CO';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase();
      console.log("Voz detectada:", transcript);
      
      let type: ReportType = 'traffic_flow';
      if (transcript.includes('retén') || transcript.includes('tránsito')) type = 'transit_checkpoint';
      else if (transcript.includes('policía') || transcript.includes('tombos')) type = 'police_presence';
      else if (transcript.includes('tráfico') || transcript.includes('lento') || transcript.includes('trancón')) type = 'traffic_flow';

      const newReportData: Partial<Report> = {
        type,
        location: { latitude: userLocation[0], longitude: userLocation[1] },
        description: `Reporte por voz: "${transcript}"`,
        reporterUid: user?.uid || '',
        reporterName: profile?.displayName || 'Usuario',
        reporterKarma: profile?.karma || 0,
        status: 'active',
        confirmations: [],
        dismissals: []
      };

      if (isOffline) {
        setOfflineQueue([...offlineQueue, newReportData]);
        alert("Sin conexión. Reporte guardado localmente.");
      } else {
        handleSubmitReport(newReportData as any);
      }
    };
    recognition.start();
  };

  const handleConfirmReport = async (reportId: string, stillThere: boolean) => {
    if (!user) return;
    const reportRef = doc(db, 'reports', reportId);
    const report = reports.find(r => r.id === reportId);
    if (!report) return;

    try {
      if (stillThere) {
        haptic('short');
        const newConfirmations = [...(report.confirmations || []), user.uid];
        const updates: any = { confirmations: newConfirmations };
        
        // Extend TTL if 5+ confirmations
        if (newConfirmations.length >= 5) {
          const currentExpiry = report.expiresAt.toDate().getTime();
          updates.expiresAt = Timestamp.fromMillis(currentExpiry + 30 * 60 * 1000);
        }
        
        await updateDoc(reportRef, updates);
        // Increase reporter karma usando increment() para evitar race conditions
        await updateDoc(doc(db, 'users', report.reporterUid), { karma: increment(1) });
      } else {
        const newDismissals = [...(report.dismissals || []), user.uid];
        await updateDoc(reportRef, { 
          dismissals: newDismissals,
          status: newDismissals.length >= 3 ? 'resolved' : 'active'
        });
      }
      setShowConfirmSheet(null);
    } catch (e) {
      console.error("Error confirming report", e);
    }
  };

  const handleSubmitReport = async (reportData: Partial<Report>) => {
    if (!user) return;
    try {
      const now = Date.now();
      const expiresAt = Timestamp.fromMillis(now + 45 * 60 * 1000);
      
      await addDoc(collection(db, 'reports'), {
        ...reportData,
        reporterUid: user.uid,
        reporterName: profile?.displayName || 'Usuario',
        reporterKarma: profile?.karma || 0,
        timestamp: serverTimestamp(),
        expiresAt,
        status: 'active',
        confirmations: [],
        dismissals: []
      });

      haptic('double');
      
      // Celebration for first report or just any report
      if (profile && profile.karma === 0) {
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#2563eb', '#f59e0b', '#ef4444']
        });
        alert("¡Ya eres parte de la comunidad CartaVía! Tu primer reporte ha sido publicado.");
      }

      setShowAddModal(false);
    } catch (e: any) {
      console.error("Error submitting report", e);
      alert("Error al enviar el reporte. Por favor intenta más tarde.");
    }
  };

  const login = async () => {
    try {
      // Usar popup en todos los dispositivos (redirect causa problemas con COOP en móvil)
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  // Listen to profile changes (for session and status)
  useEffect(() => {
    if (!user) return;

    let unsubscribe: (() => void) | null = null;

    const setupProfileListener = () => {
      unsubscribe = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as UserProfile;
          setProfile(data);

          if (data.sessionId && data.sessionId !== currentSessionId) {
            alert("Se ha iniciado sesión en otro dispositivo. Se cerrará esta sesión.");
            signOut(auth);
          }

          if (data.status === 'disabled') {
            alert("Tu cuenta ha sido deshabilitada por un administrador.");
            signOut(auth);
          }
        }
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setupProfileListener();
      } else {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    };

    setupProfileListener();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      if (unsubscribe) unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, currentSessionId]);

  useEffect(() => {
    if (!user || !showHeatmap) return;

    const q = query(
      collection(db, 'reports'),
      limit(500)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reportsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Report[];
      setHistoricalReports(reportsData);
    });

    return () => unsubscribe();
  }, [user, showHeatmap]);

  const handleRefresh = async () => {
    haptic('short');
    setIsRefreshing(true);
    // Simulate refresh delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsRefreshing(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startYRef.current = touch.pageY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const distance = touch.pageY - startYRef.current;
    if (distance > 0 && distance < 150 && window.scrollY === 0) {
      setPullDistance(distance);
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 80) {
      handleRefresh();
    }
    setPullDistance(0);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} className="absolute top-1/4 -left-40 w-80 h-80 bg-blue-600/20 rounded-full blur-3xl" />
          <motion.div animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0.4, 0.2] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }} className="absolute bottom-1/4 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
          <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.3, 0.1] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 4 }} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-3xl" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-md w-full relative z-10"
        >
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
            className="text-center mb-10"
          >
            <div className="relative inline-block mb-6">
              <motion.div
                animate={{ boxShadow: ['0 0 20px rgba(14,165,233,0.4)', '0 0 50px rgba(14,165,233,0.7)', '0 0 20px rgba(14,165,233,0.4)'] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                className="w-24 h-24 bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 rounded-[28px] flex items-center justify-center mx-auto"
              >
                <Navigation className="w-12 h-12 text-white" />
              </motion.div>
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-400 rounded-full border-2 border-slate-950 live-dot" />
            </div>
            <h1 className="text-4xl font-black text-white mb-2 tracking-tight">
              Cartagena <span className="gradient-text">Movilidad</span>
            </h1>
            <p className="text-slate-400 text-sm font-medium">Reportes en tiempo real para tu ciudad 🗺️</p>
          </motion.div>

          {/* Glass Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="glass rounded-3xl p-8 shadow-2xl"
          >
            <div className="space-y-6">
              {/* Email Form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const email = (e.target as any).email.value;
                  const password = (e.target as any).password.value;
                  try {
                    setLoading(true);
                    await signInWithEmailAndPassword(auth, email, password);
                  } catch (error: any) {
                    alert("Error al ingresar: " + error.message);
                    setLoading(false);
                  }
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Correo</label>
                  <input
                    name="email"
                    type="email"
                    required
                    className="w-full bg-slate-800/60 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                    placeholder="tu@correo.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Contraseña</label>
                  <input
                    name="password"
                    type="password"
                    required
                    className="w-full bg-slate-800/60 border border-white/10 rounded-2xl px-5 py-3.5 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 transition-all"
                    placeholder="••••••••"
                  />
                </div>
                <button
                  type="submit"
                  className="btn-primary w-full py-4 rounded-2xl font-bold text-white text-base tracking-wide relative overflow-hidden shine-effect"
                >
                  Ingresar
                </button>
              </form>

              <div className="relative flex items-center">
                <div className="flex-grow border-t border-white/10" />
                <span className="flex-shrink mx-4 text-xs font-bold text-slate-500 uppercase tracking-widest">O</span>
                <div className="flex-grow border-t border-white/10" />
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.01 }}
                onClick={login}
                className="w-full bg-white/10 hover:bg-white/15 border border-white/15 text-white font-bold py-4 px-6 rounded-2xl transition-all flex items-center justify-center gap-3"
              >
                <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
                Continuar con Google
              </motion.button>
            </div>
          </motion.div>

          <p className="text-center text-xs text-slate-600 mt-6">Cartagena, Colombia 🇨🇴</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="glass border-b border-white/8 px-5 py-3.5 flex items-center justify-between sticky top-0 z-50 shrink-0">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shrink-0 glow-cyan">
              <Navigation className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-black text-white tracking-tight leading-none">
                Cartagena <span className="gradient-text">Movilidad</span>
              </h1>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full live-dot" />
                <span className="text-[10px] text-slate-500 font-medium">{reports.length} activos</span>
              </div>
            </div>
          </div>

          {(profile?.role === 'admin' || profile?.role === 'super_admin') && (
            <nav className="hidden md:flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
              <button
                onClick={() => setActiveTab('map')}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'map'
                    ? 'bg-gradient-to-r from-cyan-500/20 to-blue-600/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Mapa
              </button>
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  activeTab === 'users'
                    ? 'bg-gradient-to-r from-cyan-500/20 to-blue-600/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Usuarios
              </button>
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
                  () => alert("Por favor habilita la ubicación en tu navegador.")
                );
              }
            }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors text-cyan-400"
            title="Mi ubicación"
          >
            <Navigation className="w-5 h-5" />
          </button>

          <div className="hidden sm:flex flex-col items-end">
            <div className="flex items-center gap-1">
              <span className="text-sm font-bold text-white">{profile?.displayName}</span>
              {profile?.role === 'super_admin' && <ShieldCheck className="w-3 h-3 text-purple-400" />}
              {profile?.role === 'admin' && <ShieldCheck className="w-3 h-3 text-cyan-400" />}
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider" style={{
              background: 'linear-gradient(135deg, #38bdf8, #818cf8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              {profile?.role === 'super_admin' ? 'Super Admin' : profile?.role === 'admin' ? 'Admin' : 'Usuario'}
            </span>
          </div>

          <button
            onClick={logout}
            className="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-full transition-colors text-slate-500"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative min-h-0">
        {activeTab === 'users' && profile && (profile.role === 'admin' || profile.role === 'super_admin') ? (
          <div className="flex-1 overflow-y-auto bg-slate-950">
            <UserManagement currentUser={user} currentProfile={profile} />
          </div>
        ) : (
          <>
            {/* Sidebar / List */}
            <div className="w-full lg:w-96 glass border-r border-white/8 flex flex-col h-[38vh] lg:h-auto shrink-0">
              <div className="px-5 py-4 border-b border-white/8 flex items-center justify-between">
                <h2 className="font-black text-white flex items-center gap-2 text-base">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full live-dot" />
                  Reportes Activos
                  <span className="ml-1 text-xs font-bold text-slate-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">{reports.length}</span>
                </h2>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="lg:hidden btn-primary text-white p-2.5 rounded-xl shadow-lg"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto p-4 space-y-3 relative"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
              >
                {/* Pull-to-Refresh */}
                <AnimatePresence>
                  {(pullDistance > 0 || isRefreshing) && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: isRefreshing ? 50 : Math.min(pullDistance, 80), opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="flex items-center justify-center overflow-hidden"
                    >
                      <motion.div
                        animate={{ rotate: isRefreshing ? 360 : pullDistance * 2 }}
                        transition={isRefreshing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
                      >
                        <Navigation className="w-5 h-5 text-cyan-400" />
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {loading ? (
                  <>
                    <ReportSkeleton />
                    <ReportSkeleton />
                    <ReportSkeleton />
                  </>
                ) : reports.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-center py-16"
                  >
                    <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/10">
                      <CheckCircle2 className="w-8 h-8 text-slate-600" />
                    </div>
                    <p className="text-slate-500 font-medium">Todo tranquilo por aquí 🛣️</p>
                    <p className="text-slate-600 text-sm mt-1">No hay reportes activos.</p>
                  </motion.div>
                ) : (
                  reports.map((report, i) => (
                    <motion.div
                      key={report.id}
                      initial={{ opacity: 0, x: -16, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 25 }}
                      onClick={() => setSelectedReport(report)}
                      className="glass-card p-4 rounded-2xl hover:bg-white/10 transition-all cursor-pointer group border border-white/8 hover:border-white/15"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl shrink-0 ${
                          report.type === 'transit_checkpoint' ? 'bg-amber-500/15 text-amber-400'
                          : report.type === 'police_presence' ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-red-500/15 text-red-400'
                        }`}>
                          <ReportTypeIcon type={report.type} className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <h3 className="font-bold text-white text-sm">{ReportTypeName(report.type)}</h3>
                            <span className="text-[10px] text-slate-500 font-medium shrink-0 ml-2">
                              {report.timestamp?.toDate ? formatDistanceToNow(report.timestamp.toDate(), { addSuffix: true, locale: es }) : 'Recién'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 line-clamp-1 mb-1.5">
                            {report.description || 'Sin descripción.'}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-slate-600">
                            <MapPin className="w-3 h-3" />
                            <span>{report.location?.latitude?.toFixed(4) ?? '?'}, {report.location?.longitude?.toFixed(4) ?? '?'}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                          {(report.reporterUid === user.uid || profile?.role === 'admin') && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await updateDoc(doc(db, 'reports', report.id), { status: 'resolved' });
                                } catch (error) {
                                  console.error('Failed to resolve report', error);
                                }
                              }}
                              className="p-1 hover:bg-emerald-500/20 text-emerald-500 rounded-lg transition-colors"
                              title="Marcar como resuelto"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

        {/* Map Area - min-h-0 es clave para que flex-1 dé altura computada en móvil */}
        <div 
          className="flex-1 relative bg-slate-200 min-h-0"
          style={{ minHeight: '250px' }}
        >
          <MapContainer 
            center={userLocation} 
            zoom={13} 
            className="w-full h-full z-0"
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapResizer />
            <RecenterMap center={userLocation} />
            <UserLocationMarker position={userLocation} />
            {!showHeatmap ? (
              <>
                {/* Retenes y Policia -> Marcadores con clustering */}
                <MarkerClusterGroup chunkedLoading>
                  {debouncedReports
                    .filter(r => r.type !== 'traffic_flow')
                    .map((report) => (
                      <ReportMarker
                        key={report.id}
                        report={report}
                        onConfirm={handleConfirmReport}
                        onSelect={(r) => setSelectedReport(r)}
                      />
                    ))}
                </MarkerClusterGroup>
                {/* Trafico lento -> Circulos de color tipo Waze */}
                {groupTrafficReports(debouncedReports).map((group, i) => (
                  <TrafficCircle
                    key={`traffic-${i}`}
                    group={group}
                    onSelect={(r) => setSelectedReport(r)}
                  />
                ))}
              </>
            ) : (
              historicalReports
                .filter(r => r.location?.latitude)
                .map((report) => (
                  <Circle
                    key={report.id}
                    center={[report.location.latitude, report.location.longitude]}
                    radius={100}
                    pathOptions={{
                      fillColor: report.type === 'transit_checkpoint' ? 'red' : 'orange',
                      fillOpacity: 0.1,
                      color: 'transparent'
                    }}
                  />
                ))
            )}
          </MapContainer>

          {/* Leyenda minimalista de trafico - solo 3 dots */}
          <div className="absolute bottom-5 left-4 z-40 flex gap-2 items-center bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
              <span className="text-[10px] text-white font-medium">Mod.</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
              <span className="text-[10px] text-white font-medium">Denso</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-[10px] text-white font-medium">Severo</span>
            </div>
          </div>

          {/* Heatmap Toggle */}
          <div className="absolute top-24 right-8 z-40">
            <button 
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={`px-4 py-2 rounded-full font-bold text-xs shadow-lg transition-all flex items-center gap-2 ${
                showHeatmap ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'
              }`}
            >
              <Info className="w-4 h-4" />
              {showHeatmap ? 'Ver Mapa Real' : 'Ver Mapa de Calor'}
            </button>
          </div>

          {/* Welcome Back Notification */}
          <AnimatePresence>
            {showWelcomeBack && (
              <motion.div 
                initial={{ y: -100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                className="absolute top-24 left-1/2 -translate-x-1/2 z-[110] w-[90%] max-w-md"
              >
                <div className="bg-blue-600 text-white rounded-2xl p-4 shadow-2xl flex items-center gap-4">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                    <Navigation className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-bold">¡Bienvenido de vuelta!</div>
                    <div className="text-xs opacity-90">Han habido nuevos reportes en tu zona desde tu última visita 👀</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toast - Radar de Proximidad */}
          <AnimatePresence>
            {approachingReport && (
              <motion.div
                initial={{ x: 120, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 120, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="absolute bottom-20 right-4 z-[100] w-64"
              >
                <div className="glass-card border border-cyan-500/20 rounded-2xl p-3 shadow-2xl flex items-center gap-3">
                  <div className="w-8 h-8 bg-cyan-500/15 rounded-lg flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Radar</div>
                    <div className="font-semibold text-white text-xs truncate">
                      {approachingReport.type === 'transit_checkpoint' ? 'Retén adelante' :
                       approachingReport.type === 'police_presence' ? 'Policía en la vía' : 'Tráfico lento'}
                    </div>
                    <div className="text-[10px] text-slate-500">~800m</div>
                  </div>
                  <button onClick={() => setApproachingReport(null)} className="text-slate-600 hover:text-slate-300 text-xs shrink-0">✕</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toast - Zona de Trafico */}
          <AnimatePresence>
            {approachingTrafficZone && (
              <motion.div
                initial={{ x: 120, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 120, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="absolute bottom-36 right-4 z-[100] w-64"
              >
                <div className={`glass-card border rounded-2xl p-3 shadow-2xl flex items-center gap-3 ${
                  approachingTrafficZone.count >= 5 ? 'border-red-500/30'
                  : approachingTrafficZone.count >= 2 ? 'border-orange-500/30'
                  : 'border-yellow-500/30'
                }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base ${
                    approachingTrafficZone.count >= 5 ? 'bg-red-500/15'
                    : approachingTrafficZone.count >= 2 ? 'bg-orange-500/15'
                    : 'bg-yellow-500/15'
                  }`}>
                    {approachingTrafficZone.count >= 5 ? '🔴' : approachingTrafficZone.count >= 2 ? '🟠' : '🟡'}
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className={`text-[10px] font-bold uppercase tracking-wider ${
                      approachingTrafficZone.count >= 5 ? 'text-red-400'
                      : approachingTrafficZone.count >= 2 ? 'text-orange-400' : 'text-yellow-400'
                    }`}>
                      {approachingTrafficZone.count >= 5 ? 'Tráfico Severo'
                      : approachingTrafficZone.count >= 2 ? 'Tráfico Denso' : 'Tráfico Moderado'}
                    </div>
                    <div className="text-[11px] font-semibold text-slate-300 leading-tight">
                      {approachingTrafficZone.count >= 2 ? 'Considera vías alternas' : 'Precaución al avanzar'}
                    </div>
                    <div className="text-[10px] text-slate-600">{approachingTrafficZone.count} rep. · ~600m</div>
                  </div>
                  <button onClick={() => setApproachingTrafficZone(null)} className="text-slate-600 hover:text-slate-300 text-xs shrink-0">✕</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Report Detail Sheet - Dark Premium */}
          <AnimatePresence>
            {selectedReport && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedReport(null)}
                  className="absolute inset-0 bg-black/60 z-[90] backdrop-blur-sm"
                />
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                  className="absolute bottom-0 left-0 right-0 z-[100]"
                >
                  <div
                    className="rounded-t-[32px] p-6 max-w-2xl mx-auto shadow-2xl"
                    style={{ background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    {/* Handle */}
                    <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />

                    {/* Header */}
                    <div className="flex items-center gap-4 mb-5">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${
                        selectedReport.type === 'transit_checkpoint' ? 'bg-amber-500/15 text-amber-400'
                        : selectedReport.type === 'police_presence' ? 'bg-blue-500/15 text-blue-400'
                        : 'bg-red-500/15 text-red-400'
                      }`}>
                        <ReportTypeIcon type={selectedReport.type} className="w-8 h-8" />
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-xl font-black text-white">{ReportTypeName(selectedReport.type)}</h3>
                        <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-0.5">
                          <Clock className="w-3.5 h-3.5" />
                          {selectedReport.timestamp?.toDate ? formatDistanceToNow(selectedReport.timestamp.toDate(), { addSuffix: true, locale: es }) : 'Recién'}
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedReport(null)}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors"
                      >
                        <X className="w-5 h-5 text-slate-500" />
                      </button>
                    </div>

                    {/* Description */}
                    {selectedReport.description && (
                      <div className="bg-white/5 border border-white/8 p-4 rounded-2xl mb-5">
                        <p className="text-slate-300 italic text-sm leading-relaxed">"{selectedReport.description}"</p>
                      </div>
                    )}

                    {/* Reporter Card */}
                    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border border-blue-500/20 rounded-2xl mb-5">
                      <div className="flex items-center gap-3">
                        <img
                          src={`https://ui-avatars.com/api/?name=${selectedReport.reporterName}&background=1e3a5f&color=38bdf8`}
                          className="w-10 h-10 rounded-full border-2 border-cyan-500/30 shadow-sm"
                          alt=""
                        />
                        <div>
                          <div className="font-bold text-white flex items-center gap-1.5">
                            {selectedReport.reporterName}
                            {((selectedReport.reporterKarma || 0) > 10 || (selectedReport.confirmations?.length || 0) >= 3) && (
                              <CheckCircle className="w-4 h-4 text-cyan-400" />
                            )}
                          </div>
                          {((selectedReport.reporterKarma || 0) > 10 || (selectedReport.confirmations?.length || 0) >= 3) && (
                            <div className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider">Reportero Confiable</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black gradient-text leading-none">{selectedReport.reporterKarma || 0}</div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase">Karma</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={() => { handleConfirmReport(selectedReport.id, true); setSelectedReport(null); }}
                        className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all"
                      >
                        <CheckCircle className="w-6 h-6" />
                        <span>Sigue ahí</span>
                        <span className="text-[10px] opacity-70">({selectedReport.confirmations?.length || 0} confirmaciones)</span>
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={() => { handleConfirmReport(selectedReport.id, false); setSelectedReport(null); }}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 font-bold py-4 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all"
                      >
                        <X className="w-6 h-6" />
                        <span>Ya no está</span>
                        <span className="text-[10px] opacity-70">({selectedReport.dismissals?.length || 0} reportes)</span>
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Confirm Sheet - Dark Premium */}
          <AnimatePresence>
            {showConfirmSheet && (
              <motion.div
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 28, stiffness: 220 }}
                className="absolute bottom-0 left-0 right-0 z-[100]"
              >
                <div
                  className="rounded-t-[32px] p-6 max-w-2xl mx-auto shadow-2xl"
                  style={{ background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-6" />
                  <div className="text-center mb-6">
                    <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <ShieldAlert className="w-7 h-7 text-cyan-400" />
                    </div>
                    <h3 className="text-xl font-black text-white mb-1">¿Sigue el reporte aquí?</h3>
                    <p className="text-slate-500 text-sm">Ayuda a la comunidad confirmando la veracidad del dato.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => handleConfirmReport(showConfirmSheet.id, true)}
                      className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all"
                    >
                      <CheckCircle className="w-5 h-5" /> Sigue ahí
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => handleConfirmReport(showConfirmSheet.id, false)}
                      className="bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all"
                    >
                      <X className="w-5 h-5" /> Ya no está
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Offline Indicator */}
          <AnimatePresence>
            {isOffline && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] bg-amber-500 text-white px-4 py-1 rounded-full text-xs font-bold flex items-center gap-2 shadow-lg"
              >
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Modo Sin Conexión
              </motion.div>
            )}
          </AnimatePresence>

          {/* Floating Action Buttons */}
          <div className="absolute bottom-8 right-5 z-40 flex flex-col gap-3 items-end">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              onClick={startVoiceReporting}
              className={`w-13 h-13 rounded-full shadow-2xl flex items-center justify-center transition-all ${
                isListening
                  ? 'bg-red-500 text-white glow-blue animate-pulse'
                  : 'glass-card text-slate-300 hover:text-white border border-white/15'
              }`}
              style={{ width: 52, height: 52 }}
            >
              <Mic className="w-5 h-5" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.93 }}
              onClick={() => setShowAddModal(true)}
              className="btn-primary text-white rounded-full shadow-2xl flex items-center justify-center relative overflow-hidden shine-effect"
              style={{ width: 64, height: 64 }}
            >
              <Plus className="w-8 h-8" />
            </motion.button>
          </div>
        </div>
          </>
        )}
      </main>

      {/* Add Report Bottom Sheet */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[200] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="relative w-full max-w-2xl rounded-t-[36px] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
              style={{ background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(40px)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* Handle */}
              <div className="pt-5 pb-3 px-6 flex items-center justify-between shrink-0">
                <div className="w-10" />
                <div className="w-12 h-1 bg-white/20 rounded-full" />
                <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-7 overflow-y-auto flex-1 pb-10">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-white mb-1">Nuevo Reporte</h2>
                  <p className="text-slate-400 text-sm">Ayuda a otros conductores informando lo que ves.</p>
                </div>

                {/* Type Selection */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">¿Qué está pasando?</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['transit_checkpoint', 'police_presence', 'traffic_flow'] as ReportType[]).map((type) => (
                      <motion.button
                        key={type}
                        whileTap={{ scale: 0.95 }}
                        whileHover={{ scale: 1.02 }}
                        onClick={() => { haptic('short'); setNewReport({ ...newReport, type }); }}
                        className={`p-5 rounded-3xl border-2 transition-all text-center flex flex-col items-center gap-3 ${
                          newReport.type === type
                            ? 'border-cyan-500/50 bg-cyan-500/10 shadow-lg shadow-cyan-500/10'
                            : 'border-white/8 bg-white/5 hover:border-white/20 hover:bg-white/8'
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                          newReport.type === type
                            ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-lg shadow-cyan-500/30'
                            : 'bg-white/10 text-slate-400'
                        }`}>
                          <ReportTypeIcon type={type} className="w-6 h-6" />
                        </div>
                        <span className={`text-xs font-black leading-tight ${
                          newReport.type === type ? 'text-cyan-400' : 'text-slate-400'
                        }`}>{ReportTypeName(type)}</span>
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Detalles adicionales</label>
                  <textarea
                    value={newReport.description}
                    onChange={(e) => setNewReport({ ...newReport, description: e.target.value })}
                    placeholder="Ej: Retén en la Av. Pedro de Heredia, sentido centro..."
                    className="w-full bg-white/5 border border-white/10 rounded-3xl p-5 text-white placeholder-slate-600 focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500/30 outline-none transition-all h-28 resize-none text-sm"
                  />
                </div>

                {/* Location Picker */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Ubicación</label>
                    <button
                      onClick={() => {
                        haptic('short');
                        if (!navigator.geolocation) { alert('Tu dispositivo no soporta geolocalización.'); return; }
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const lat = pos.coords.latitude;
                            const lng = pos.coords.longitude;
                            setUserLocation([lat, lng]);
                            setNewReport(prev => ({ ...prev, latitude: lat, longitude: lng }));
                          },
                          (err) => {
                            console.error('Geolocation error:', err);
                            alert('No se pudo obtener tu ubicación. Habilita permisos de ubicación y que HTTPS esté activo.');
                          },
                          { enableHighAccuracy: true, timeout: 10000 }
                        );
                      }}
                      className="text-xs text-cyan-400 font-bold hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
                    >
                      <Navigation className="w-3.5 h-3.5" />
                      Usar mi ubicación
                    </button>
                  </div>
                  <div className="h-64 rounded-3xl overflow-hidden border border-white/10 shadow-inner relative">
                    <MapContainer center={userLocation} zoom={15} className="w-full h-full">
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      <RecenterMap center={userLocation} />
                      <MapResizer />
                      <LocationPicker onLocationSelect={(lat, lng) => {
                        haptic('short');
                        setNewReport({ ...newReport, latitude: lat, longitude: lng });
                      }} />
                      <UserLocationMarker position={userLocation} />
                    </MapContainer>
                    {!newReport.latitude && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-none flex items-center justify-center">
                        <div className="glass px-5 py-2.5 rounded-full shadow-2xl font-bold text-white text-sm flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-cyan-400" />
                          Toca el mapa para marcar
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    haptic('short');
                    if (!newReport.latitude || !newReport.longitude) return;
                    handleSubmitReport({
                      type: newReport.type,
                      description: newReport.description,
                      location: { latitude: newReport.latitude, longitude: newReport.longitude }
                    });
                  }}
                  disabled={!newReport.latitude}
                  className={`w-full py-5 rounded-3xl font-black text-lg transition-all relative overflow-hidden ${
                    newReport.latitude
                      ? 'btn-primary text-white shine-effect'
                      : 'bg-white/5 text-slate-600 cursor-not-allowed border border-white/8'
                  }`}
                >
                  Publicar Reporte
                </motion.button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
