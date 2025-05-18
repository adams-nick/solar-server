/**
 * Comprehensive Solar Analysis Router
 *
 * Provides two endpoints:
 * 1. POST to start analysis and get an analysis ID
 * 2. GET with the analysis ID to establish SSE connection
 */

const express = require("express");
const router = express.Router();
const axios = require("axios");

// Import the data-layers module
const dataLayers = require("../../data-layers");
// Import the processor and visualizer directly for roof segments
const RoofSegmentProcessor = require("../../data-layers/layers/roof-segments/roof-segments-processor");
const RoofSegmentVisualizer = require("../../data-layers/layers/roof-segments/roof-segments-visualizer");

// ML server URL - should be configurable via environment variable
const ML_SERVER_URL = process.env.ML_SERVER_URL || "http://localhost:8000";

// Create API client for the data layer manager
const apiClient = {
  apiKey: process.env.GOOGLE_MAPS_API_KEY,
  async get(url, options = {}) {
    return axios.get(url, options);
  },
};

// Create layer manager instance
const layerManager = dataLayers.createLayerManager(apiClient);

// Simple in-memory store for analysis sessions
const analysisSessions = new Map();

/**
 * POST /api/v1/solar/comprehensive-analysis
 *
 * Initiates a comprehensive solar analysis and returns an analysis ID
 */
router.post("/comprehensive-analysis", async (req, res) => {
  try {
    // Extract location from request body
    const { location } = req.body;

    // Validate location
    if (!location || !location.latitude || !location.longitude) {
      return res.status(400).json({
        success: false,
        message: "Valid location with latitude and longitude is required",
      });
    }

    // Generate a unique analysis ID
    const analysisId = generateId();

    // Store session info
    analysisSessions.set(analysisId, {
      id: analysisId,
      location,
      status: "pending",
      createdAt: new Date(),
    });

    console.log(
      `Created new analysis session: ${analysisId} for location: ${location.latitude}, ${location.longitude}`
    );

    // Return the analysis ID
    return res.status(201).json({
      success: true,
      message: "Analysis session created",
      analysisId,
    });
  } catch (error) {
    console.error("Error creating analysis session:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create analysis session",
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/solar/comprehensive-analysis/:analysisId/stream
 *
 * Establishes an SSE connection to stream analysis results
 */
router.get("/comprehensive-analysis/:analysisId/stream", (req, res) => {
  const { analysisId } = req.params;

  // Check if analysis session exists
  if (!analysisSessions.has(analysisId)) {
    return res.status(404).json({
      success: false,
      message: "Analysis session not found",
    });
  }

  // Get the analysis session
  const session = analysisSessions.get(analysisId);
  const location = session.location;

  console.log(`Starting SSE stream for analysis: ${analysisId}`);

  // Set headers for SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send initial message
  sendSSEEvent(res, "start", {
    message: "Analysis started",
    location,
  });

  // Start the comprehensive solar analysis process
  processComprehensiveAnalysis(res, session);

  // Handle client disconnect
  req.on("close", () => {
    console.log(`Client disconnected from analysis: ${analysisId}`);

    // Clean up the session after some time
    cleanupSession(analysisId);
  });
});

// ----- Helper Functions -----

/**
 * Generate a simple unique ID
 * @returns {string} Unique ID
 */
function generateId() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

/**
 * Send an SSE event
 * @param {Object} res - Express response object
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function sendSSEEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(
    `data: ${JSON.stringify({
      timestamp: new Date().toISOString(),
      ...data,
    })}\n\n`
  );
}

/**
 * Schedule a session for cleanup
 * @param {string} analysisId - Analysis session ID
 */
function cleanupSession(analysisId) {
  setTimeout(() => {
    if (analysisSessions.has(analysisId)) {
      analysisSessions.delete(analysisId);
      console.log(`Cleaned up analysis session: ${analysisId}`);
    }
  }, 60000); // Clean up after 1 minute
}

/**
 * Process comprehensive solar analysis
 * @param {Object} res - Express response object for SSE
 * @param {Object} session - Analysis session
 */
async function processComprehensiveAnalysis(res, session) {
  const location = session.location;
  const analysisId = session.id;
  const startTime = Date.now();

  // Store results to pass between steps
  let processingResults = {
    buildingInsights: null,
    rgbResult: null,
    dsmResult: null,
    roofSegmentsResult: null,
    mlServerResult: null,
    dataLayersResponse: null,
  };

  try {
    // Update session status
    session.status = "running";

    // Step 1: Progress update
    sendSSEEvent(res, "progress", {
      progress: 10,
      message: "Fetching building insights...",
    });

    // Step 2: Fetch building insights
    try {
      processingResults.buildingInsights = await fetchBuildingInsights(
        location
      );

      // Send building insights to client
      sendSSEEvent(res, "buildingInsights", {
        progress: 25,
        data: processingResults.buildingInsights,
      });
    } catch (error) {
      console.error(
        `Error fetching building insights for analysis ${analysisId}:`,
        error
      );
      sendSSEEvent(res, "progress", {
        progress: 25,
        message:
          "Building insights unavailable, continuing with data layers...",
        error: error.message,
      });
    }

    // Step 3: Fetch data layers
    sendSSEEvent(res, "progress", {
      progress: 30,
      message: "Fetching data layers...",
    });

    try {
      processingResults.dataLayersResponse = await fetchDataLayers(location);
      console.log("Data layers response received:", {
        hasRgbUrl: !!processingResults.dataLayersResponse.rgbUrl,
        hasDsmUrl: !!processingResults.dataLayersResponse.dsmUrl,
        hasMaskUrl: !!processingResults.dataLayersResponse.maskUrl,
        imageryQuality: processingResults.dataLayersResponse.imageryQuality,
      });

      // Process RGB image if available
      if (processingResults.dataLayersResponse.rgbUrl) {
        sendSSEEvent(res, "progress", {
          progress: 35,
          message: "Processing RGB imagery...",
        });

        try {
          // Process the RGB layer with proper visualization
          processingResults.rgbResult = await processRgbLayer(
            location,
            processingResults.dataLayersResponse
          );

          console.log(
            "RGB processing complete. Full metadata:",
            JSON.stringify(processingResults.rgbResult.metadata, null, 2)
          );
          console.log(
            "RGB dimensions from metadata:",
            processingResults.rgbResult.metadata?.dimensions?.width +
              "x" +
              processingResults.rgbResult.metadata?.dimensions?.height
          );
          console.log(
            "RGB buildingBoundaries:",
            JSON.stringify(
              processingResults.rgbResult.buildingBoundaries,
              null,
              2
            )
          );

          // Send RGB visualization to client
          sendSSEEvent(res, "visualization", {
            progress: 40,
            type: "rgb",
            // Include the processed dataUrls with both views
            dataUrls: processingResults.rgbResult.dataUrls,
            metadata: {
              imageryDate: processingResults.dataLayersResponse.imageryDate,
              imageryQuality:
                processingResults.dataLayersResponse.imageryQuality,
              dimensions: processingResults.rgbResult.metadata?.dimensions,
              hasMask: processingResults.rgbResult.metadata?.hasMask,
              buildingBoundaries:
                processingResults.rgbResult.metadata?.buildingBoundaries,
            },
            bounds: processingResults.rgbResult.bounds,
          });
        } catch (rgbError) {
          console.error(
            `Error processing RGB layer for analysis ${analysisId}:`,
            rgbError
          );
          sendSSEEvent(res, "progress", {
            progress: 40,
            message:
              "RGB imagery processing failed, continuing with analysis...",
            error: rgbError.message,
          });
        }
      }
    } catch (error) {
      console.error(
        `Error fetching data layers for analysis ${analysisId}:`,
        error
      );
      sendSSEEvent(res, "progress", {
        progress: 40,
        message: "Data layers unavailable, continuing with roof segments...",
        error: error.message,
      });
    }

    // Step 4: Process roof segments (if building insights available)
    if (processingResults.buildingInsights) {
      sendSSEEvent(res, "progress", {
        progress: 50,
        message: "Processing roof segments...",
      });

      try {
        // Process roof segments using real implementation
        processingResults.roofSegmentsResult = await processRoofSegments(
          processingResults.buildingInsights
        );

        if (processingResults.roofSegmentsResult.available) {
          // Send real roof segment visualization to client
          sendSSEEvent(res, "visualization", {
            progress: 60,
            type: "roofSegments",
            visualizations: processingResults.roofSegmentsResult.visualizations,
            segments: processingResults.roofSegmentsResult.data,
            metadata: processingResults.roofSegmentsResult.metadata,
            bounds: processingResults.roofSegmentsResult.bounds,
            available: true,
          });
        } else {
          // Send error that roof segments couldn't be processed
          sendSSEEvent(res, "progress", {
            progress: 60,
            message:
              "Roof segment processing failed: " +
              (processingResults.roofSegmentsResult.error ||
                "No viable roof segments found"),
            error: processingResults.roofSegmentsResult.error,
          });
        }
      } catch (segmentError) {
        console.error(
          `Error processing roof segments for analysis ${analysisId}:`,
          segmentError
        );
        sendSSEEvent(res, "progress", {
          progress: 60,
          message:
            "Roof segment processing failed, continuing with analysis...",
          error: segmentError.message,
        });
      }
    }

    // Step 5: Process ML server roof segmentation (if RGB data and building insights available)
    if (processingResults.rgbResult && processingResults.buildingInsights) {
      sendSSEEvent(res, "progress", {
        progress: 70,
        message: "Processing advanced roof segmentation with ML...",
      });

      try {
        // Process with ML server
        processingResults.mlServerResult =
          await processMlServerRoofSegmentation(
            processingResults.rgbResult,
            processingResults.buildingInsights,
            processingResults.roofSegmentsResult?.data,
            processingResults.dataLayersResponse
          );

        // Send ML server results to client
        if (
          processingResults.mlServerResult &&
          processingResults.mlServerResult.success
        ) {
          sendSSEEvent(res, "visualization", {
            progress: 80,
            type: "mlRoofSegments",
            segments: processingResults.mlServerResult.roof_segments || [],
            obstructions: processingResults.mlServerResult.obstructions || [],
            dataUrl: processingResults.mlServerResult.visualization,
            metadata: {
              segmentCount:
                processingResults.mlServerResult.roof_segments?.length || 0,
              obstructionCount:
                processingResults.mlServerResult.obstructions?.length || 0,
              processingTime: processingResults.mlServerResult.processing_time,
            },
          });
        } else {
          sendSSEEvent(res, "progress", {
            progress: 80,
            message: "ML roof segmentation completed with issues.",
            error:
              processingResults.mlServerResult?.error ||
              "Unknown ML processing error",
          });
        }
      } catch (mlError) {
        console.error(
          `Error processing ML server roof segmentation for analysis ${analysisId}:`,
          mlError
        );
        sendSSEEvent(res, "progress", {
          progress: 80,
          message: "ML roof segmentation failed, continuing with analysis...",
          error: mlError.message,
        });
      }
    }

    // Step 6: Completion
    const completionTime = Date.now() - startTime;
    sendSSEEvent(res, "complete", {
      progress: 100,
      message: "Analysis completed successfully",
      duration: completionTime,
    });

    // Update session status
    session.status = "completed";
    session.completedAt = new Date();
  } catch (error) {
    console.error(`Error processing analysis ${analysisId}:`, error);

    // Send error event
    sendSSEEvent(res, "error", {
      message: "An error occurred during analysis",
      error: error.message,
    });

    // Update session status
    session.status = "error";
    session.error = error.message;
  }
}

/**
 * Fetch building insights from Google Solar API
 * @param {Object} location - Location object with latitude and longitude
 * @returns {Promise<Object>} Building insights data
 */
async function fetchBuildingInsights(location) {
  try {
    console.log(
      `Fetching building insights for location: ${location.latitude}, ${location.longitude}`
    );

    const response = await axios({
      method: "GET",
      url: "https://solar.googleapis.com/v1/buildingInsights:findClosest",
      params: {
        "location.latitude": location.latitude,
        "location.longitude": location.longitude,
        requiredQuality: "HIGH",
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 30000, // 30 second timeout
    });

    console.log("Building insights API response received");
    return response.data;
  } catch (error) {
    console.error("Error fetching building insights:", error);

    if (error.response) {
      throw new Error(
        `Building insights API error: ${error.response.status} - ${
          error.response.data.error?.message || "Unknown error"
        }`
      );
    } else if (error.request) {
      throw new Error("No response received from Building Insights API");
    } else {
      throw new Error(`Failed to fetch building insights: ${error.message}`);
    }
  }
}

/**
 * Fetch data layers from Google Solar API
 * @param {Object} location - Location object with latitude and longitude
 * @returns {Promise<Object>} Data layers data
 */
async function fetchDataLayers(location) {
  try {
    console.log(
      `Fetching data layers for location: ${location.latitude}, ${location.longitude}`
    );

    const response = await axios({
      method: "GET",
      url: "https://solar.googleapis.com/v1/dataLayers:get",
      params: {
        "location.latitude": location.latitude,
        "location.longitude": location.longitude,
        radius_meters: 50, // You can adjust this based on building size
        required_quality: "LOW", // Request at least LOW quality (will get best available)
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 30000, // 30 second timeout
    });

    console.log("Data layers API response received");
    return response.data;
  } catch (error) {
    console.error("Error fetching data layers:", error);

    if (error.response) {
      throw new Error(
        `Data layers API error: ${error.response.status} - ${
          error.response.data.error?.message || "Unknown error"
        }`
      );
    } else if (error.request) {
      throw new Error("No response received from Data Layers API");
    } else {
      throw new Error(`Failed to fetch data layers: ${error.message}`);
    }
  }
}

/**
 * Process RGB layer using the layer manager
 * @param {Object} location - Location object with latitude and longitude
 * @param {Object} dataLayersResponse - Response from the data layers API
 * @returns {Promise<Object>} Processed RGB layer data
 */
async function processRgbLayer(location, dataLayersResponse) {
  try {
    console.log(
      `Processing RGB layer for location: ${location.latitude}, ${location.longitude}`
    );

    // Create a proper radius that matches the area in the data layers
    const radius = 50; // Default radius, adjust as needed

    // Use the layer manager to process the RGB layer
    // This will download the GeoTIFF, process it, and create base64 visualizations
    console.log("Calling layer manager to process RGB layer with options:", {
      radius,
      layerUrl: dataLayersResponse.rgbUrl
        ? "[RGB URL present]"
        : "[No RGB URL]",
      maskUrl: dataLayersResponse.maskUrl
        ? "[Mask URL present]"
        : "[No Mask URL]",
      buildingFocus: true,
      cropToBuilding: true,
      fallbackToSynthetic: false,
    });

    const result = await layerManager.processLayer("rgb", location, {
      radius,
      layerUrl: dataLayersResponse.rgbUrl, // Pass the RGB URL directly
      maskUrl: dataLayersResponse.maskUrl, // Pass the mask URL if available
      buildingFocus: true, // Request a building-focused view
      cropToBuilding: true, // Ensure we crop to the building
      fallbackToSynthetic: false, // Don't use synthetic data if real data fails
    });

    // Log detailed information about the result received from layer manager
    console.log("RGB layer processing raw result structure:", {
      hasVisualization: !!result.visualization,
      hasProcessedData: !!result.processedData,
      hasMetadata: !!result.metadata,
      hasBuildingBoundaries: !!result.buildingBoundaries,
      dimensionsInMetadata: result.metadata?.dimensions
        ? `${result.metadata.dimensions.width}x${result.metadata.dimensions.height}`
        : "Dimensions not in metadata",
      dimensionsInProcessedData: result.processedData?.metadata?.dimensions
        ? `${result.processedData.metadata.dimensions.width}x${result.processedData.metadata.dimensions.height}`
        : "Dimensions not in processedData.metadata",
      buildingBoundariesInfo: result.buildingBoundaries?.hasBuilding
        ? `width=${result.buildingBoundaries.width}, height=${result.buildingBoundaries.height}`
        : "No building boundaries or building not found",
    });

    // Check if we got a valid result
    if (!result || !result.visualization) {
      throw new Error(
        "RGB processing did not return expected visualization data"
      );
    }

    // Extract the visualization data
    let dataUrls = {};

    // Check if the visualization is already in the expected format with both views
    if (
      typeof result.visualization === "object" &&
      (result.visualization.buildingFocus || result.visualization.fullImage)
    ) {
      // It's already in the right format
      dataUrls = {
        buildingFocus: result.visualization.buildingFocus,
        fullImage: result.visualization.fullImage,
      };
    } else {
      // It's just a single data URL - use it for both views
      dataUrls = {
        buildingFocus: result.visualization,
        fullImage: result.visualization,
      };
    }

    // Get dimensions directly from either metadata or processed data
    const dimensions = {
      width:
        result.metadata?.dimensions?.width ||
        result.processedData?.metadata?.dimensions?.width ||
        (result.buildingBoundaries?.hasBuilding
          ? result.buildingBoundaries.width
          : 0),
      height:
        result.metadata?.dimensions?.height ||
        result.processedData?.metadata?.dimensions?.height ||
        (result.buildingBoundaries?.hasBuilding
          ? result.buildingBoundaries.height
          : 0),
    };

    console.log(
      "Final RGB dimensions being used:",
      `${dimensions.width}x${dimensions.height}`
    );

    // Return the complete processed data
    return {
      imageryQuality: dataLayersResponse.imageryQuality || "MEDIUM",
      dataUrls: dataUrls,
      layerType: "rgb",
      metadata: {
        ...result.metadata,
        dimensions: dimensions,
        hasMask: !!dataLayersResponse.maskUrl,
        buildingBoundaries: result.buildingBoundaries?.hasBuilding
          ? {
              exists: true,
              width: result.buildingBoundaries.width,
              height: result.buildingBoundaries.height,
            }
          : { exists: false },
      },
      bounds: result.bounds,
      buildingBoundaries: result.buildingBoundaries,
    };
  } catch (error) {
    console.error("Error processing RGB layer:", error);
    throw error;
  }
}

/**
 * Process DSM layer using the layer manager
 * @param {Object} location - Location object with latitude and longitude
 * @param {Object} dataLayersResponse - Response from the data layers API
 * @param {Object} rgbDimensions - Dimensions to match from the RGB processing
 * @returns {Promise<Object>} Processed DSM layer data
 */
async function processDsmLayer(
  location,
  dataLayersResponse,
  rgbResults = null
) {
  try {
    console.log(
      `Processing DSM layer for location: ${location.latitude}, ${location.longitude}`
    );

    if (!dataLayersResponse.dsmUrl) {
      throw new Error("DSM URL not available in data layers response");
    }

    // Create a proper radius that matches the area in the data layers
    const radius = 50; // Default radius, adjust as needed

    // Process DSM with its own natural resolution and cropping
    const options = {
      radius,
      layerUrl: dataLayersResponse.dsmUrl,
      maskUrl: dataLayersResponse.maskUrl,
      buildingFocus: true,
      cropToBuilding: true, // Ensure we crop to the building boundary
      fallbackToSynthetic: false,
      // Remove targetDimensions from here - let DSM be processed at its native resolution
    };

    console.log("Calling layer manager to process DSM layer with options:", {
      ...options,
      layerUrl: options.layerUrl ? "[DSM URL present]" : "[No DSM URL]",
      maskUrl: options.maskUrl ? "[Mask URL present]" : "[No Mask URL]",
    });

    // Process DSM at its native resolution
    const result = await layerManager.processLayer("dsm", location, options);

    // Get dimensions from processed DSM result
    const dsmWidth =
      result.processedData.metadata?.dimensions?.width ||
      result.metadata?.dimensions?.width ||
      0;
    const dsmHeight =
      result.processedData.metadata?.dimensions?.height ||
      result.metadata?.dimensions?.height ||
      0;

    console.log(`DSM processing native dimensions: ${dsmWidth}x${dsmHeight}`);

    // Extract RGB dimensions for comparison
    let rgbWidth = 0,
      rgbHeight = 0;
    if (rgbResults && rgbResults.metadata && rgbResults.metadata.dimensions) {
      rgbWidth = rgbResults.metadata.dimensions.width;
      rgbHeight = rgbResults.metadata.dimensions.height;
      console.log(`Target RGB dimensions: ${rgbWidth}x${rgbHeight}`);
    }

    // Check if we need to resize AFTER natural cropping
    let finalRaster = result.processedData?.raster || null;
    let finalDimensions = { width: dsmWidth, height: dsmHeight };

    // Only resample if both sets of dimensions are valid and they don't match
    if (
      rgbWidth > 0 &&
      rgbHeight > 0 &&
      (dsmWidth !== rgbWidth || dsmHeight !== rgbHeight)
    ) {
      console.log(
        `Resampling DSM data AFTER cropping to match RGB dimensions: ${rgbWidth}x${rgbHeight}`
      );

      // Use visualization utils to resample the ALREADY CROPPED raster
      finalRaster = VisualizationUtils.resampleRaster(
        finalRaster,
        dsmWidth,
        dsmHeight, // source dimensions
        rgbWidth,
        rgbHeight, // target dimensions
        {
          noDataValue: config.processing.NO_DATA_VALUE,
          method: "bilinear",
        }
      );

      finalDimensions = { width: rgbWidth, height: rgbHeight };
      console.log(
        `DSM data resampled to ${rgbWidth}x${rgbHeight} after natural cropping`
      );
    }

    // Return the processed DSM data with potentially resampled dimensions
    return {
      layerType: "dsm",
      bounds: result.bounds,
      buildingBoundaries: result.buildingBoundaries,
      // Use the potentially resampled raster
      raster: finalRaster,
      // Use original raster if needed for reference
      originalRaster: result.processedData?.raster || null,
      metadata: {
        dimensions: finalDimensions,
        originalDimensions: { width: dsmWidth, height: dsmHeight },
        hasMask: !!dataLayersResponse.maskUrl,
        dataRange: result.processedData?.metadata?.dataRange ||
          result.metadata?.dataRange || { min: 0, max: 100 },
      },
    };
  } catch (error) {
    console.error("Error processing DSM layer:", error);
    throw new Error(`Failed to process DSM data: ${error.message}`);
  }
}

/**
 * Process roof segments from building insights data
 * @param {Object} buildingInsightsData - Building insights data from Google Solar API
 * @returns {Promise<Object>} Processed roof segments with visualizations
 */
async function processRoofSegments(buildingInsightsData) {
  try {
    console.log("Processing roof segments from building insights data");

    // Create processor and visualizer instances directly
    const roofSegmentProcessor = new RoofSegmentProcessor();
    const roofSegmentVisualizer = new RoofSegmentVisualizer();

    // Process the roof segment data
    const processedData = await roofSegmentProcessor.process(
      buildingInsightsData
    );

    // Filter out segments that are too small to hold at least one panel
    const solarPotential = buildingInsightsData.solarPotential;
    const panelWidth = solarPotential.panelWidthMeters || 1.045;
    const panelHeight = solarPotential.panelHeightMeters || 1.879;
    const minPanelArea = panelWidth * panelHeight;

    // Add some margin for installation constraints
    const installationFactor = 1.1; // 10% extra space needed for mounting
    const minSegmentArea = minPanelArea * installationFactor;

    // Filter the segments
    const viableSegments = processedData.roofSegments.filter((segment) => {
      // Check if segment is large enough for a panel
      const isLargeEnough = segment.area >= minSegmentArea;

      // Optionally, also check suitability
      const hasReasonableSuitability = segment.suitability > 0.2; // Minimum 20% suitability

      return isLargeEnough && hasReasonableSuitability;
    });

    console.log(
      `Filtered from ${processedData.roofSegments.length} to ${viableSegments.length} viable roof segments`
    );

    // Skip processing if no viable segments
    if (viableSegments.length === 0) {
      return {
        error: "No viable roof segments found",
        available: false,
      };
    }

    // Create a new processed data object with filtered segments
    const filteredData = {
      ...processedData,
      roofSegments: viableSegments,
      metadata: {
        ...processedData.metadata,
        viableSegmentCount: viableSegments.length,
        originalSegmentCount: processedData.roofSegments.length,
      },
    };

    // Create visualizations with different color modes
    const suitabilityVisualization = await roofSegmentVisualizer.visualize(
      filteredData,
      {
        colorMode: "suitability",
        showLabels: true,
        showLegend: true,
      }
    );

    const orientationVisualization = await roofSegmentVisualizer.visualize(
      filteredData,
      {
        colorMode: "orientation",
        showLegend: true,
      }
    );

    // Calculate total viable area
    const totalViableArea = viableSegments.reduce(
      (sum, segment) => sum + segment.area,
      0
    );

    // Return the processed data
    return {
      data: viableSegments,
      visualizations: {
        suitability: suitabilityVisualization,
        orientation: orientationVisualization,
      },
      bounds: processedData.bounds,
      metadata: {
        totalViableArea: totalViableArea.toFixed(2),
        segmentCount: viableSegments.length,
        minPanelArea: minPanelArea.toFixed(2),
        originalSegmentCount: processedData.roofSegments.length,
      },
      available: true,
    };
  } catch (error) {
    console.error("Error processing roof segments:", error);
    return {
      error: error.message,
      available: false,
    };
  }
}

/**
 * Process roof segmentation with ML server
 * @param {Object} rgbResult - Processed RGB data
 * @param {Object} buildingInsights - Building insights data
 * @param {Array} roofSegments - Processed roof segments (optional)
 * @param {Object} dataLayersResponse - Data layers response from Google Solar API
 * @returns {Promise<Object>} ML server processing results
 */
async function processMlServerRoofSegmentation(
  rgbResult,
  buildingInsights,
  roofSegments = null,
  dataLayersResponse = null
) {
  try {
    console.log("Processing ML server roof segmentation");

    // Debug the rgbResult object thoroughly
    console.log("RGB Result structure received:", {
      hasDataUrls: !!rgbResult.dataUrls,
      hasMetadata: !!rgbResult.metadata,
      hasBuildingBoundaries: !!rgbResult.buildingBoundaries,
      metadataDimensions: rgbResult.metadata?.dimensions
        ? `${rgbResult.metadata.dimensions.width}x${rgbResult.metadata.dimensions.height}`
        : "No dimensions in metadata",
      fullMetadata: JSON.stringify(rgbResult.metadata || {}, null, 2),
    });

    // Extract building ID from building insights
    const buildingId = buildingInsights.name || `building_${Date.now()}`;

    // Get RGB image data URL
    const rgbImage = rgbResult.dataUrls.buildingFocus;
    if (!rgbImage) {
      throw new Error("RGB image data URL not available for ML processing");
    }

    // Extract dimensions directly from RGB result
    // Make sure to get the cropped dimensions that were actually used
    const imageWidth = rgbResult.metadata?.dimensions?.width;
    const imageHeight = rgbResult.metadata?.dimensions?.height;

    // Log the dimensions we're using
    console.log(
      `Using RGB dimensions for ML processing: ${imageWidth}x${imageHeight}`
    );

    // Validate dimensions
    if (!imageWidth || !imageHeight || imageWidth === 0 || imageHeight === 0) {
      throw new Error(
        `Invalid RGB dimensions for ML processing: ${imageWidth}x${imageHeight}`
      );
    }

    // Convert geocoordinates to pixel coordinates
    const pixelCoordinates = convertGeoToPixel({
      imgWidth: imageWidth,
      imgHeight: imageHeight,
      buildingBoundingBox: buildingInsights.boundingBox,
      buildingCenter: buildingInsights.center,
      roofSegments:
        roofSegments || buildingInsights.solarPotential?.roofSegmentStats || [],
    });

    console.log("Converted pixel coordinates:", {
      buildingBox: pixelCoordinates.buildingBox,
      roofSegments: pixelCoordinates.roofSegments.length,
    });

    // Process DSM data if available - pass RGB dimensions to ensure consistency
    let dsmData = null;

    // Process DSM data if available - pass RGB results to ensure post-process alignment
    if (dataLayersResponse && dataLayersResponse.dsmUrl) {
      try {
        console.log("Processing DSM data for ML server request");
        const location = {
          latitude: buildingInsights.center.latitude,
          longitude: buildingInsights.center.longitude,
        };

        // Process the DSM data at native resolution first
        const dsmResult = await processDsmLayer(
          location,
          dataLayersResponse,
          rgbResult // Pass full RGB result instead of just dimensions
        );

        // Get final dimensions after potential resampling
        const dsmWidth = dsmResult.metadata?.dimensions?.width;
        const dsmHeight = dsmResult.metadata?.dimensions?.height;

        // Log dimensions for verification
        console.log(
          "Dimensions check - RGB:",
          `${imageWidth}x${imageHeight}`,
          "DSM:",
          `${dsmWidth}x${dsmHeight}`
        );

        if (dsmResult && dsmResult.raster) {
          // Create DSM data for ML server
          dsmData = {
            // Convert to regular array for serialization if needed
            elevationData: Array.isArray(dsmResult.raster)
              ? dsmResult.raster
              : Array.from(dsmResult.raster),
            dimensions: {
              width: dsmWidth,
              height: dsmHeight,
            },
            dataRange: dsmResult.metadata.dataRange,
          };

          console.log("DSM data prepared for ML server:", {
            dimensions: dsmData.dimensions,
            dataRangePresent: !!dsmData.dataRange,
            elevationDataLength: dsmData.elevationData.length,
          });
        }
      } catch (dsmError) {
        console.error("Error processing DSM data:", dsmError);
        console.log("Continuing ML request without DSM data");
        dsmData = null;
      }
    }

    // Create request data for ML server
    const requestData = {
      building_id: buildingId,
      rgb_image: rgbImage,
      image_width: imageWidth,
      image_height: imageHeight,
      building_box: pixelCoordinates.buildingBox,
      roof_segments: pixelCoordinates.roofSegments,
      building_center: pixelCoordinates.buildingCenter,
    };

    // Add DSM data if available
    if (dsmData) {
      requestData.dsm_data = dsmData;
    }

    // Log the request data (without image data)
    const logData = { ...requestData };
    if (logData.rgb_image) logData.rgb_image = "[RGB IMAGE DATA URL]";
    if (logData.dsm_data)
      logData.dsm_data = {
        dimensions: requestData.dsm_data.dimensions,
        dataRange: requestData.dsm_data.dataRange,
        elevationDataLength: requestData.dsm_data.elevationData.length,
      };

    console.log("ML server request data:", JSON.stringify(logData, null, 2));

    // Send request to ML server
    const startTime = Date.now();
    console.log("Sending request to ML server...");
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      requestData,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000, // 60 second timeout for ML processing
      }
    );

    const processingTime = Date.now() - startTime;
    console.log(`ML server response received in ${processingTime}ms`);

    // Process response
    const mlData = mlResponse.data;

    // Add processing time to result
    mlData.processing_time = processingTime;
    mlData.success = true;

    return mlData;
  } catch (error) {
    console.error("Error processing with ML server:", error);

    // Capture detailed error information
    let errorDetails = {
      message: error.message,
      type: error.response ? "ml_server_error" : "connection_error",
    };

    if (error.response) {
      errorDetails.status = error.response.status;
      errorDetails.statusText = error.response.statusText;
      errorDetails.data = error.response.data;
    }

    console.error("Error details:", JSON.stringify(errorDetails, null, 2));

    // Return error information
    return {
      success: false,
      error: error.message,
      error_type: error.response ? "ml_server_error" : "connection_error",
      error_details: error.response?.data || {},
    };
  }
}

/**
 * Convert geographic coordinates to pixel coordinates for ML server
 * @param {Object} params - Input parameters
 * @param {number} params.imgWidth - Image width in pixels
 * @param {number} params.imgHeight - Image height in pixels
 * @param {Object} params.buildingBoundingBox - Geographic bounding box of the building
 * @param {Object} params.buildingCenter - Geographic center of the building
 * @param {Array} params.roofSegments - Array of roof segment objects with geographic coordinates
 * @returns {Object} - Converted coordinates for ML server
 */
function convertGeoToPixel(params) {
  const {
    imgWidth,
    imgHeight,
    buildingBoundingBox,
    buildingCenter,
    roofSegments,
  } = params;

  console.log("Converting geo to pixel with parameters:", {
    imgWidth,
    imgHeight,
    hasBuildingBoundingBox: !!buildingBoundingBox,
    hasBuildingCenter: !!buildingCenter,
    roofSegmentsCount: roofSegments ? roofSegments.length : 0,
  });

  // Function to convert a single geographic coordinate to pixels
  function geoToPixel(lat, lng, bounds) {
    // If bounds are not available, return center of image
    if (!bounds || !bounds.ne || !bounds.sw) {
      return { x: imgWidth / 2, y: imgHeight / 2 };
    }

    // Calculate pixel coordinates
    // Note: In images, Y increases downward
    const x =
      ((lng - bounds.sw.longitude) /
        (bounds.ne.longitude - bounds.sw.longitude)) *
      imgWidth;
    const y =
      ((bounds.ne.latitude - lat) / (bounds.ne.latitude - bounds.sw.latitude)) *
      imgHeight;

    return {
      x: Math.min(Math.max(0, Math.round(x)), imgWidth - 1),
      y: Math.min(Math.max(0, Math.round(y)), imgHeight - 1),
    };
  }

  // Convert building center to pixel coordinates
  let buildingCenterPixel = { x: imgWidth / 2, y: imgHeight / 2 };
  if (buildingCenter && buildingCenter.latitude && buildingCenter.longitude) {
    buildingCenterPixel = geoToPixel(
      buildingCenter.latitude,
      buildingCenter.longitude,
      buildingBoundingBox
    );
  }

  // Convert building bounding box to pixel coordinates
  let buildingBoxPixel = {
    min_x: 0,
    min_y: 0,
    max_x: imgWidth - 1,
    max_y: imgHeight - 1,
  };

  if (buildingBoundingBox && buildingBoundingBox.sw && buildingBoundingBox.ne) {
    const swPixel = geoToPixel(
      buildingBoundingBox.sw.latitude,
      buildingBoundingBox.sw.longitude,
      buildingBoundingBox
    );
    const nePixel = geoToPixel(
      buildingBoundingBox.ne.latitude,
      buildingBoundingBox.ne.longitude,
      buildingBoundingBox
    );

    buildingBoxPixel = {
      min_x: Math.min(swPixel.x, nePixel.x),
      min_y: Math.min(swPixel.y, nePixel.y),
      max_x: Math.max(swPixel.x, nePixel.x),
      max_y: Math.max(swPixel.y, nePixel.y),
    };
  }

  // Convert roof segments to pixel coordinates
  const roofSegmentsPixel = [];

  if (Array.isArray(roofSegments) && roofSegments.length > 0) {
    for (const segment of roofSegments) {
      // Different segment formats might be present based on source
      // Handle Solar API's roofSegmentStats format
      if (
        segment.boundingBox ||
        (segment.center && segment.stats?.stats?.areaMeters2)
      ) {
        let segmentBox = {};

        if (segment.boundingBox) {
          // Format from BuildingInsights
          const swPixel = geoToPixel(
            segment.boundingBox.sw.latitude,
            segment.boundingBox.sw.longitude,
            buildingBoundingBox
          );
          const nePixel = geoToPixel(
            segment.boundingBox.ne.latitude,
            segment.boundingBox.ne.longitude,
            buildingBoundingBox
          );

          segmentBox = {
            min_x: Math.min(swPixel.x, nePixel.x),
            min_y: Math.min(swPixel.y, nePixel.y),
            max_x: Math.max(swPixel.x, nePixel.x),
            max_y: Math.max(swPixel.y, nePixel.y),
          };
        } else if (segment.center) {
          // Alternative format where only center is available
          // Create a bounding box around the center based on area
          const centerPixel = geoToPixel(
            segment.center.latitude,
            segment.center.longitude,
            buildingBoundingBox
          );

          // Estimate dimensions from area if available
          const area = segment.stats?.stats?.areaMeters2 || 10;
          const estimatedRadius = Math.sqrt(area) * 2; // Convert to pixel radius
          const pixelRadius = Math.max(20, Math.min(100, estimatedRadius)); // Constrain to reasonable size

          segmentBox = {
            min_x: Math.max(0, centerPixel.x - pixelRadius),
            min_y: Math.max(0, centerPixel.y - pixelRadius),
            max_x: Math.min(imgWidth - 1, centerPixel.x + pixelRadius),
            max_y: Math.min(imgHeight - 1, centerPixel.y + pixelRadius),
          };
        }

        const segmentPixel = {
          id:
            segment.segmentIndex !== undefined
              ? `segment_${segment.segmentIndex}`
              : `segment_${roofSegmentsPixel.length}`,
          ...segmentBox,
        };

        // Copy other properties that might be useful for ML
        if (segment.pitchDegrees !== undefined)
          segmentPixel.pitch = segment.pitchDegrees;
        if (segment.azimuthDegrees !== undefined)
          segmentPixel.azimuth = segment.azimuthDegrees;

        roofSegmentsPixel.push(segmentPixel);
      }
    }
  }

  console.log("Converted pixel coordinates result:", {
    buildingCenterPixel,
    buildingBoxWidth: buildingBoxPixel.max_x - buildingBoxPixel.min_x,
    buildingBoxHeight: buildingBoxPixel.max_y - buildingBoxPixel.min_y,
    roofSegmentsCount: roofSegmentsPixel.length,
  });

  // Return the converted values
  return {
    buildingCenter: buildingCenterPixel,
    buildingBox: buildingBoxPixel,
    roofSegments: roofSegmentsPixel,
    imageWidth: imgWidth,
    imageHeight: imgHeight,
  };
}

module.exports = router;
