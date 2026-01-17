import { MongoClient, Db } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add MONGODB_URI to your .env file');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

// In development, use a global variable so the MongoClient is not recreated on hot reload
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;

export async function getDatabase(): Promise<Db> {
  const client = await clientPromise;
  return client.db('mobilify');
}

// Database types matching our schema
export interface DbReport {
  _id?: string;
  createdAt: Date;
  updatedAt: Date;

  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };

  media: {
    type: 'image' | 'video';
    url: string;
    fileName: string;
    fileSize: number;
  };

  ai: {
    category: string;
    severity: 'low' | 'medium' | 'high';
    summary: string;
    confidence: number;
  };

  geoMethod: 'auto' | 'manual';

  status: 'open' | 'acknowledged' | 'resolved';

  routing?: {
    assignedAreaId: string | null;
    matchedBy: 'geoWithin' | 'manual' | null;
    matchedAt: Date | null;
  };
}

export interface DbArea {
  _id?: string;
  name: string;
  createdAt: Date;

  polygon: {
    type: 'Polygon';
    coordinates: number[][][];
  };

  priority: number;
  isActive: boolean;
}
