/**
 * Geofence & Office QR Engine for WorkNest HR
 * Computes Haversine distances, generates & validates branch QR tokens,
 * and handles GPS geofencing verification for physical in-office attendance.
 */

export interface OfficeBranchLocation {
  id: string;
  name: string;
  code: string;
  companyId?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  qrSecret?: string;
}

export interface GeofenceVerificationResult {
  isWithinBounds: boolean;
  distanceMeters: number;
  allowedRadiusMeters: number;
  branchName: string;
  errorMessage?: string;
}

/**
 * Calculate the great-circle distance between two points on the Earth (Haversine formula).
 * Returns distance in meters.
 */
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Generate a standard secure QR payload string for a branch.
 */
export function generateBranchQRPayload(branch: {
  id: string;
  companyId?: string;
  code: string;
  qrSecret?: string;
}): string {
  const secret = branch.qrSecret || `sec_${branch.id}_${branch.code}`;
  return JSON.stringify({
    prefix: 'WORKNEST_ATTENDANCE_QR',
    v: 1,
    companyId: branch.companyId || 'default',
    branchId: branch.id,
    code: branch.code,
    secret: secret,
  });
}

/**
 * Parse and validate scanned QR string.
 */
export function parseScannedQRPayload(qrText: string): {
  valid: boolean;
  companyId?: string;
  branchId?: string;
  code?: string;
  secret?: string;
  rawText?: string;
} {
  try {
    const trimmed = qrText.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed.prefix === 'WORKNEST_ATTENDANCE_QR' && parsed.branchId) {
        return {
          valid: true,
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          code: parsed.code,
          secret: parsed.secret,
          rawText: trimmed,
        };
      }
    }

    // Fallback: Check if it's formatted as standard text URI e.g. worknest://qr/branchId
    if (trimmed.includes('worknest') || trimmed.includes('BRANCH') || trimmed.includes('HQ')) {
      return {
        valid: true,
        branchId: trimmed,
        rawText: trimmed,
      };
    }

    return { valid: false, rawText: trimmed };
  } catch (err) {
    return { valid: false, rawText: qrText };
  }
}

/**
 * Verify whether an employee's coordinates fall within the branch's permitted geofence radius.
 */
export function verifyGeofenceBounds(
  employeeLat: number,
  employeeLng: number,
  branch: OfficeBranchLocation
): GeofenceVerificationResult {
  const branchLat = branch.latitude;
  const branchLng = branch.longitude;
  const radius = branch.radiusMeters || 100; // Default 100 meters

  if (branchLat === undefined || branchLng === undefined || isNaN(branchLat) || isNaN(branchLng)) {
    // If branch has no coordinates set, allow attendance with warning or require geofence setup
    return {
      isWithinBounds: true,
      distanceMeters: 0,
      allowedRadiusMeters: radius,
      branchName: branch.name,
    };
  }

  const distance = calculateHaversineDistance(employeeLat, employeeLng, branchLat, branchLng);

  if (distance <= radius) {
    return {
      isWithinBounds: true,
      distanceMeters: distance,
      allowedRadiusMeters: radius,
      branchName: branch.name,
    };
  }

  return {
    isWithinBounds: false,
    distanceMeters: distance,
    allowedRadiusMeters: radius,
    branchName: branch.name,
    errorMessage: `Location Mismatch: You are ${distance}m away from "${branch.name}". Allowed radius is within ${radius}m. Attendance from outside the office is blocked.`,
  };
}
