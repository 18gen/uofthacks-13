import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

// POST /api/db/init - Initialize database indexes
export async function POST() {
  try {
    const db = await getDatabase();

    // Create geospatial index for reports location
    await db.collection('reports').createIndex(
      { location: '2dsphere' },
      { background: true }
    );

    // Create geospatial index for areas polygon
    await db.collection('areas').createIndex(
      { polygon: '2dsphere' },
      { background: true }
    );

    // Create indexes for common queries
    await db.collection('reports').createIndex(
      { status: 1 },
      { background: true }
    );

    await db.collection('reports').createIndex(
      { createdAt: -1 },
      { background: true }
    );

    await db.collection('reports').createIndex(
      { 'routing.assignedAreaId': 1 },
      { background: true }
    );

    await db.collection('reports').createIndex(
      { 'ai.category': 1, 'ai.severity': 1 },
      { background: true }
    );

    return NextResponse.json({
      success: true,
      message: 'Database indexes created successfully',
    });
  } catch (error) {
    console.error('Failed to initialize database:', error);
    return NextResponse.json(
      { error: 'Failed to initialize database' },
      { status: 500 }
    );
  }
}

// GET /api/db/init - Check database status
export async function GET() {
  try {
    const db = await getDatabase();

    // Check collections exist
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    // Get counts
    const reportsCount = await db.collection('reports').countDocuments();
    const areasCount = await db.collection('areas').countDocuments();

    return NextResponse.json({
      connected: true,
      collections: collectionNames,
      counts: {
        reports: reportsCount,
        areas: areasCount,
      },
    });
  } catch (error) {
    console.error('Database check failed:', error);
    return NextResponse.json(
      { connected: false, error: 'Database connection failed' },
      { status: 500 }
    );
  }
}
