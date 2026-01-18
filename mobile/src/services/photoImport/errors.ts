/**
 * Custom error classes for photo import service.
 */

export class PhotoServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoServiceError';
  }
}

export class PermissionDeniedError extends PhotoServiceError {
  readonly permissionType: 'mediaLibrary' | 'location';

  constructor(permissionType: 'mediaLibrary' | 'location') {
    super(`${permissionType} permission denied`);
    this.name = 'PermissionDeniedError';
    this.permissionType = permissionType;
  }
}

export class ScanCancelledError extends PhotoServiceError {
  constructor() {
    super('Scan cancelled');
    // Use 'AbortError' name to match AbortController convention
    this.name = 'AbortError';
  }
}

export class HomeCountryNotSetError extends PhotoServiceError {
  constructor() {
    super('Home country not set');
    this.name = 'HomeCountryNotSetError';
  }
}
