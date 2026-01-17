import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, DbReport } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// GET /api/reports - List all reports
export async function GET() {
  try {
    const db = await getDatabase();
    const reports = await db
      .collection<DbReport>('reports')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // Transform to match frontend Report type
    const transformedReports = reports.map((report) => ({
      id: report._id?.toString(),
      createdAt: report.createdAt.toISOString(),
      coordinates: {
        lat: report.location.coordinates[1],
        lng: report.location.coordinates[0],
      },
      mediaUrl: report.media.url,
      mediaType: report.media.type,
      fileName: report.media.fileName,
      fileSize: report.media.fileSize,
      analysis: {
        category: report.ai.category,
        severity: report.ai.severity,
        summary: report.ai.summary,
        confidence: report.ai.confidence,
      },
      geoMethod: report.geoMethod,
      status: report.status,
    }));

    return NextResponse.json(transformedReports);
  } catch (error) {
    console.error('Failed to fetch reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

// POST /api/reports - Create a new report
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { coordinates, mediaUrl, mediaType, fileName, fileSize, analysis, geoMethod } = body;

    const db = await getDatabase();

    // Create the report document
    const now = new Date();
    const report: DbReport = {
      createdAt: now,
      updatedAt: now,
      location: {
        type: 'Point',
        coordinates: [coordinates.lng, coordinates.lat], // GeoJSON uses [lng, lat]
      },
      media: {
        type: mediaType,
        url: mediaUrl,
        fileName,
        fileSize,
      },
      ai: {
        category: analysis.category,
        severity: analysis.severity,
        summary: analysis.summary,
        confidence: analysis.confidence,
      },
      geoMethod,
      status: 'open',
    };

    // Try to find matching area for routing
    const matchingArea = await db.collection('areas').findOne({
      polygon: {
        $geoIntersects: {
          $geometry: report.location,
        },
      },
      isActive: true,
    });

    if (matchingArea) {
      report.routing = {
        assignedAreaId: matchingArea._id.toString(),
        matchedBy: 'geoWithin',
        matchedAt: now,
      };
    }

    const result = await db.collection<DbReport>('reports').insertOne(report);

    // Return the created report in frontend format
    const createdReport = {
      id: result.insertedId.toString(),
      createdAt: report.createdAt.toISOString(),
      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng,
      },
      mediaUrl: report.media.url,
      mediaType: report.media.type,
      fileName: report.media.fileName,
      fileSize: report.media.fileSize,
      analysis: {
        category: report.ai.category,
        severity: report.ai.severity,
        summary: report.ai.summary,
        confidence: report.ai.confidence,
      },
      geoMethod: report.geoMethod,
      status: report.status,
    };

    return NextResponse.json(createdReport, { status: 201 });
  } catch (error) {
    console.error('Failed to create report:', error);
    return NextResponse.json(
      { error: 'Failed to create report' },
      { status: 500 }
    );
  }
}
