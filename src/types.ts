export type ReportType = 'transit_checkpoint' | 'police_presence' | 'traffic_flow';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface Report {
  id: string;
  type: ReportType;
  location: Location;
  description?: string;
  timestamp: any; // Firestore Timestamp
  expiresAt: any; // Firestore Timestamp
  reporterUid: string;
  reporterName?: string;
  reporterKarma?: number;
  status: 'active' | 'resolved' | 'expired';
  confirmations?: string[];
  dismissals?: string[];
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role: 'user' | 'admin' | 'super_admin';
  status: 'active' | 'disabled' | 'pending';
  sessionId?: string;
  karma: number;
  createdAt?: any;
}
