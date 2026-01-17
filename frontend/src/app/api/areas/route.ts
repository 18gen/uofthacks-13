import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, DbArea } from '@/lib/mongodb';

// GET /api/areas - List all areas
export async function GET() {
  try {
    const db = await getDatabase();
    const areas = await db
      .collection<DbArea>('areas')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // Transform to match frontend AdminArea type
    const transformedAreas = areas.map((area) => ({
      id: area._id?.toString(),
      name: area.name,
      geometry: area.polygon,
      createdAt: area.createdAt.toISOString(),
    }));

    return NextResponse.json(transformedAreas);
  } catch (error) {
    console.error('Failed to fetch areas:', error);
    return NextResponse.json(
      { error: 'Failed to fetch areas' },
      { status: 500 }
    );
  }
}

// POST /api/areas - Create a new area
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, geometry } = body;

    const db = await getDatabase();

    const now = new Date();
    const area: DbArea = {
      name: name || `Area ${Date.now()}`,
      createdAt: now,
      polygon: geometry,
      priority: 10,
      isActive: true,
    };

    const result = await db.collection<DbArea>('areas').insertOne(area);

    const createdArea = {
      id: result.insertedId.toString(),
      name: area.name,
      geometry: area.polygon,
      createdAt: area.createdAt.toISOString(),
    };

    return NextResponse.json(createdArea, { status: 201 });
  } catch (error) {
    console.error('Failed to create area:', error);
    return NextResponse.json(
      { error: 'Failed to create area' },
      { status: 500 }
    );
  }
}
