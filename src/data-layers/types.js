/**
 * Type definitions for SolarScanner data-layers module
 *
 * This file provides JSDoc type definitions for the data-layers module.
 * While JavaScript doesn't enforce these types at runtime, they provide
 * documentation and can be used with TypeScript or IDEs that support JSDoc types.
 */

/**
 * Location coordinates
 * @typedef {Object} Location
 * @property {number} latitude - Latitude coordinate in decimal degrees
 * @property {number} longitude - Longitude coordinate in decimal degrees
 */

/**
 * Geographic bounds
 * @typedef {Object} Bounds
 * @property {number} north - Northern latitude boundary in decimal degrees
 * @property {number} south - Southern latitude boundary in decimal degrees
 * @property {number} east - Eastern longitude boundary in decimal degrees
 * @property {number} west - Western longitude boundary in decimal degrees
 */

/**
 * RGB Color representation
 * @typedef {Object} Color
 * @property {number} r - Red component (0-255)
 * @property {number} g - Green component (0-255)
 * @property {number} b - Blue component (0-255)
 */

/**
 * RGBA Color representation with alpha channel
 * @typedef {Object} ColorRGBA
 * @property {number} r - Red component (0-255)
 * @property {number} g - Green component (0-255)
 * @property {number} b - Blue component (0-255)
 * @property {number} a - Alpha component (0-255)
 */

/**
 * Options for visualization operations
 * @typedef {Object} VisualizationOptions
 * @property {number} [month] - Month index (0-11) for seasonal adjustments
 * @property {number} [maxDimension] - Maximum dimension for output image
 * @property {number} [maxWidth] - Maximum width for output image
 * @property {number} [maxHeight] - Maximum height for output image
 * @property {boolean} [buildingFocus=true] - Whether to focus on building boundaries
 * @property {number} [margin=20] - Margin to add around building boundaries
 * @property {number} [min] - Minimum value for data normalization
 * @property {number} [max] - Maximum value for data normalization
 * @property {string} [paletteName] - Name of predefined color palette to use
 * @property {Array<Color>} [palette] - Custom color palette to use
 * @property {boolean} [useAlpha=true] - Whether to use alpha channel for null values
 * @property {string} [mimeType='image/png'] - MIME type for output
 * @property {number} [quality=0.92] - Quality for image compression (0-1)
 * @property {boolean} [synthetic=false] - Whether to create synthetic visualization
 */

/**
 * Options for data processing operations
 * @typedef {Object} ProcessingOptions
 * @property {number} [page=0] - Page/image index for multi-page TIFFs
 * @property {Array<number>} [samples] - Specific samples/bands to read
 * @property {boolean} [convertToArray=false] - Convert TypedArrays to regular arrays
 * @property {boolean} [useSharp=false] - Use sharp for processing if true
 * @property {number} [noDataValue=-9999] - Value to treat as no-data
 * @property {number} [threshold=0] - Threshold value for mask data
 * @property {boolean} [normalize=false] - Normalize data to 0-1 range
 */

/**
 * Options for data fetching operations
 * @typedef {Object} FetchOptions
 * @property {string} [quality='LOW'] - Imagery quality (LOW, MEDIUM, HIGH)
 * @property {number} [radius=50] - Radius in meters for data query
 * @property {number} [timeout=30000] - Request timeout in milliseconds
 * @property {number} [maxRetries=3] - Maximum retries for failed requests
 * @property {number} [retryDelay=1000] - Delay between retries
 * @property {boolean} [useCache=false] - Whether to use cached data
 */

/**
 * Raster data representation
 * @typedef {Object} RasterData
 * @property {TypedArray|Array<number>} data - The raster data values
 * @property {number} width - Width of the raster in pixels
 * @property {number} height - Height of the raster in pixels
 * @property {Object} [metadata] - Additional metadata about the raster
 * @property {Bounds} [bounds] - Geographic bounds of the raster
 * @property {number} [noDataValue] - Value representing no data
 */

/**
 * Metadata for GeoTIFF files
 * @typedef {Object} GeoTiffMetadata
 * @property {number} width - Width of the image in pixels
 * @property {number} height - Height of the image in pixels
 * @property {number} bands - Number of bands/samples per pixel
 * @property {number} pages - Number of pages/images in the TIFF
 * @property {Object} [tiepoint] - Ground control point information
 * @property {Array} [pixelScale] - Scale of pixels in geographic units
 * @property {Object} [geoKeys] - Geographic keys from GeoTIFF
 * @property {Object} [fileDirectory] - TIFF file directory information
 */

/**
 * Building boundary information
 * @typedef {Object} BuildingBoundaries
 * @property {number} minX - Minimum X coordinate
 * @property {number} maxX - Maximum X coordinate
 * @property {number} minY - Minimum Y coordinate
 * @property {number} maxY - Maximum Y coordinate
 * @property {number} width - Width of the boundaries
 * @property {number} height - Height of the boundaries
 * @property {boolean} hasBuilding - Whether a building was found
 */

/**
 * Layer type enum
 * @typedef {string} LayerType
 * @enum {string}
 * @property {string} MASK - 'mask' - Building mask layer
 * @property {string} DSM - 'dsm' - Digital Surface Model layer
 * @property {string} RGB - 'rgb' - RGB aerial imagery layer
 * @property {string} ANNUAL_FLUX - 'annualFlux' - Annual solar flux layer
 * @property {string} MONTHLY_FLUX - 'monthlyFlux' - Monthly solar flux layer
 * @property {string} HOURLY_SHADE - 'hourlyShade' - Hourly shade layer
 */

/**
 * Response from the Google Solar API data layers endpoint
 * @typedef {Object} DataLayersResponse
 * @property {Object} imageryDate - Date of the imagery
 * @property {number} imageryDate.year - Year
 * @property {number} imageryDate.month - Month
 * @property {number} imageryDate.day - Day
 * @property {Object} imageryProcessedDate - Date the imagery was processed
 * @property {string} dsmUrl - URL for the Digital Surface Model data
 * @property {string} rgbUrl - URL for the RGB aerial imagery
 * @property {string} maskUrl - URL for the building mask data
 * @property {string} annualFluxUrl - URL for the annual solar flux data
 * @property {string} monthlyFluxUrl - URL for the monthly solar flux data
 * @property {Array<string>} hourlyShadeUrls - URLs for hourly shade data by month
 * @property {string} imageryQuality - Quality of the imagery (HIGH, MEDIUM, LOW)
 */

/**
 * Response from the Google Solar API building insights endpoint
 * @typedef {Object} BuildingInsightsResponse
 * @property {string} name - Building identifier
 * @property {Location} center - Geographic center of the building
 * @property {Object} boundingBox - Bounding box of the building
 * @property {Object} imageryDate - Date of the imagery
 * @property {Object} imageryProcessedDate - Date the imagery was processed
 * @property {string} postalCode - Postal code of the building
 * @property {string} administrativeArea - Administrative area of the building
 * @property {string} statisticalArea - Statistical area of the building
 * @property {string} regionCode - Region code of the building
 * @property {Object} solarPotential - Solar potential information
 * @property {string} imageryQuality - Quality of the imagery (HIGH, MEDIUM, LOW)
 */

/**
 * Result of processing a data layer
 * @typedef {Object} ProcessedLayerResult
 * @property {string} layerType - Type of the layer
 * @property {Location} location - Location coordinates
 * @property {Object} processedData - Processed data
 * @property {string} visualization - Data URL of the visualization
 * @property {boolean} [synthetic=false] - Whether the visualization is synthetic
 * @property {string} [imageryQuality] - Quality of the source imagery
 * @property {string} [error] - Error message if processing failed
 */

// Export all types
module.exports = {};
