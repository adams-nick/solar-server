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
const CombinedFluxDsmVisualizer = require("../../data-layers/combined-visualizers/combined-flux-dsm-visualizer");
const {
  VisualizationUtils,
} = require("../../data-layers/utils/visualization-utils");
// Import solar panel analysis module
const solarPanelAnalysis = require("../../utils/solarPanelAnalysis");
// TODO const config = require("../../config");

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
    annualFluxResult: null,
    combinedVisualizationResult: null, // NEW: Combined flux+DSM visualization
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
        hasAnnualFluxUrl: !!processingResults.dataLayersResponse.annualFluxUrl,
        imageryQuality: processingResults.dataLayersResponse.imageryQuality,
      });

      // Process RGB image if available
      if (processingResults.dataLayersResponse.rgbUrl) {
        sendSSEEvent(res, "progress", {
          progress: 32,
          message: "Processing RGB imagery...",
        });

        try {
          processingResults.rgbResult = await processRgbLayer(
            location,
            processingResults.dataLayersResponse
          );

          console.log(
            "RGB processing complete. Dimensions:",
            processingResults.rgbResult.metadata?.dimensions?.width +
              "x" +
              processingResults.rgbResult.metadata?.dimensions?.height
          );

          // Send RGB visualization to client
          sendSSEEvent(res, "visualization", {
            progress: 35,
            type: "rgb",
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
            progress: 35,
            message:
              "RGB imagery processing failed, continuing with analysis...",
            error: rgbError.message,
          });
        }
      }

      // Process DSM data if available
      if (processingResults.dataLayersResponse.dsmUrl) {
        sendSSEEvent(res, "progress", {
          progress: 38,
          message: "Processing DSM data...",
        });

        try {
          processingResults.dsmResult = await processDsmLayer(
            location,
            processingResults.dataLayersResponse,
            processingResults.rgbResult
          );

          console.log(
            "DSM processing complete. Dimensions:",
            processingResults.dsmResult.metadata?.dimensions?.width +
              "x" +
              processingResults.dsmResult.metadata?.dimensions?.height
          );
        } catch (dsmError) {
          console.error(
            `Error processing DSM layer for analysis ${analysisId}:`,
            dsmError
          );
          sendSSEEvent(res, "progress", {
            progress: 38,
            message: "DSM data processing failed, continuing with analysis...",
            error: dsmError.message,
          });
        }
      }

      // Process Annual Flux data if available
      if (processingResults.dataLayersResponse.annualFluxUrl) {
        sendSSEEvent(res, "progress", {
          progress: 42,
          message: "Processing annual solar flux data...",
        });

        try {
          processingResults.annualFluxResult = await processAnnualFluxLayer(
            location,
            processingResults.dataLayersResponse,
            processingResults.rgbResult
          );

          console.log(
            "Annual flux processing complete. Dimensions:",
            processingResults.annualFluxResult.metadata?.dimensions?.width +
              "x" +
              processingResults.annualFluxResult.metadata?.dimensions?.height
          );

          // Send annual flux visualization to client
          sendSSEEvent(res, "visualization", {
            progress: 45,
            type: "annualFlux",
            dataUrls: processingResults.annualFluxResult.dataUrls,
            metadata: {
              imageryDate: processingResults.dataLayersResponse.imageryDate,
              imageryQuality:
                processingResults.dataLayersResponse.imageryQuality,
              dimensions:
                processingResults.annualFluxResult.metadata?.dimensions,
              dataRange: processingResults.annualFluxResult.metadata?.dataRange,
              statistics: processingResults.annualFluxResult.statistics,
            },
            bounds: processingResults.annualFluxResult.bounds,
          });
        } catch (annualFluxError) {
          console.error(
            `Error processing annual flux layer for analysis ${analysisId}:`,
            annualFluxError
          );
          sendSSEEvent(res, "progress", {
            progress: 45,
            message:
              "Annual flux data processing failed, continuing with analysis...",
            error: annualFluxError.message,
          });
        }
      }

      // NEW: Create Combined Flux+DSM Visualization if both are available
      // NEW: Create Combined Flux+DSM Visualization if both are available
      if (processingResults.annualFluxResult && processingResults.dsmResult) {
        sendSSEEvent(res, "progress", {
          progress: 47,
          message:
            "Creating enhanced flux+DSM visualization for ML analysis...",
        });

        try {
          console.log("=== COMBINED VISUALIZATION DEBUG ===");
          console.log("About to create combined visualization...");

          processingResults.combinedVisualizationResult =
            await createCombinedFluxDsmVisualization(
              processingResults.annualFluxResult,
              processingResults.dsmResult
            );

          console.log("Combined visualization result:", {
            success: !!processingResults.combinedVisualizationResult,
            enhanced: processingResults.combinedVisualizationResult?.enhanced,
            hasDataUrls:
              !!processingResults.combinedVisualizationResult?.dataUrls,
            hasBuildingFocus:
              !!processingResults.combinedVisualizationResult?.dataUrls
                ?.buildingFocus,
          });

          console.log("Combined flux+DSM visualization created successfully");

          // Send combined visualization to client
          sendSSEEvent(res, "visualization", {
            progress: 48,
            type: "combinedFluxDsm",
            dataUrls: processingResults.combinedVisualizationResult.dataUrls,
            metadata: {
              enhanced: processingResults.combinedVisualizationResult.enhanced,
              blendMode:
                processingResults.combinedVisualizationResult.metadata
                  ?.blendMode,
              dsmInfluence:
                processingResults.combinedVisualizationResult.metadata
                  ?.dsmInfluence,
              dimensions:
                processingResults.combinedVisualizationResult.metadata
                  ?.dimensions,
            },
          });
        } catch (combinedError) {
          console.error(
            `Error creating combined flux+DSM visualization for analysis ${analysisId}:`,
            combinedError
          );

          // IMPORTANT: Make sure we don't set combinedVisualizationResult to undefined
          console.log(
            "Setting combinedVisualizationResult to null due to error"
          );
          processingResults.combinedVisualizationResult = null;

          sendSSEEvent(res, "progress", {
            progress: 48,
            message:
              "Combined visualization failed, will use individual data for analysis...",
            error: combinedError.message,
          });
        }
      }
    } catch (error) {
      console.error(
        `Error fetching data layers for analysis ${analysisId}:`,
        error
      );
      sendSSEEvent(res, "progress", {
        progress: 48,
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
        processingResults.roofSegmentsResult = await processRoofSegments(
          processingResults.buildingInsights
        );

        if (processingResults.roofSegmentsResult.available) {
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

    // Step 5: Process ML server roof segmentation (UPDATED to use combined visualization)
    // Step 5: Process ML server roof segmentation (UPDATED to use combined visualization)
    if (processingResults.buildingInsights) {
      sendSSEEvent(res, "progress", {
        progress: 70,
        message: "Processing advanced roof segmentation with ML...",
      });

      try {
        // DEBUG: Check what results we have available
        console.log("=== ML PROCESSING DEBUG ===");
        console.log(
          "Has combinedVisualizationResult:",
          !!processingResults.combinedVisualizationResult
        );
        console.log(
          "Has annualFluxResult:",
          !!processingResults.annualFluxResult
        );
        console.log("Has rgbResult:", !!processingResults.rgbResult);

        if (processingResults.combinedVisualizationResult) {
          console.log(
            "Combined result keys:",
            Object.keys(processingResults.combinedVisualizationResult)
          );
          console.log(
            "Combined result enhanced:",
            processingResults.combinedVisualizationResult.enhanced
          );
          console.log(
            "Combined result has dataUrls:",
            !!processingResults.combinedVisualizationResult.dataUrls
          );
        }

        // Priority order: Combined visualization > Annual Flux > RGB
        let mlResult = null;

        if (processingResults.combinedVisualizationResult) {
          // Use the combined flux+DSM visualization (BEST OPTION)
          console.log(
            "Using combined flux+DSM visualization for ML processing"
          );
          mlResult = await processMlServerRoofSegmentationWithCombined(
            processingResults.combinedVisualizationResult,
            processingResults.buildingInsights,
            processingResults.roofSegmentsResult?.data
          );
        } else if (processingResults.annualFluxResult) {
          // Fallback to annual flux only
          console.log("Using annual flux data for ML processing (fallback)");
          mlResult = await processMlServerRoofSegmentationWithFlux(
            processingResults.annualFluxResult,
            processingResults.buildingInsights,
            processingResults.roofSegmentsResult?.data
          );
        } else if (processingResults.rgbResult) {
          // Final fallback to RGB
          console.log("Using RGB data for ML processing (final fallback)");
          mlResult = await processMlServerRoofSegmentation(
            processingResults.rgbResult,
            processingResults.buildingInsights,
            processingResults.roofSegmentsResult?.data
          );
        }

        processingResults.mlServerResult = mlResult;

        // ... rest of the ML processing code remains the same

        // If we have ML results, generate solar panel layout and obstructions
        if (
          processingResults.mlServerResult &&
          processingResults.mlServerResult.success
        ) {
          sendSSEEvent(res, "progress", {
            progress: 75,
            message: "Detecting obstructions and generating panel layout...",
          });

          try {
            // Calculate real-world dimensions for the image
            const realWorldDimensions = calculateRealWorldDimensions(
              processingResults.combinedVisualizationResult ||
                processingResults.annualFluxResult ||
                processingResults.rgbResult,
              processingResults.buildingInsights
            );

            // Generate obstructions using the DSM data
            const obstructionResult = detectObstructions(
              processingResults.mlServerResult.roof_segments || [],
              processingResults.dsmResult,
              realWorldDimensions,
              processingResults.roofSegmentsResult?.data || []
            );

            if (!processingResults.mlServerResult.obstructions) {
              processingResults.mlServerResult.obstructions = [];
            }

            processingResults.mlServerResult.obstructions =
              obstructionResult.obstructions;
            console.log(
              `Detected ${obstructionResult.obstructions.length} obstructions`
            );

            // Generate optimal panel layout
            const optimalLayoutResult =
              solarPanelAnalysis.generateOptimalPanelLayout(
                processingResults.mlServerResult.roof_segments || [],
                obstructionResult.obstructions || [],
                realWorldDimensions,
                processingResults.dsmResult
              );

            processingResults.mlServerResult.panel_layout =
              optimalLayoutResult.panelLayout;
            processingResults.mlServerResult.layout_metadata =
              optimalLayoutResult.metadata;

            console.log(
              `Generated optimal panel layout with ${optimalLayoutResult.panelLayout.length} panels`
            );
          } catch (layoutError) {
            console.error(
              `Error detecting obstructions and generating panel layout: ${layoutError.message}`
            );
            sendSSEEvent(res, "progress", {
              progress: 75,
              message:
                "Obstruction detection and panel layout generation failed, continuing with analysis...",
              error: layoutError.message,
            });
          }
        }

        // Send ML server results to client
        if (
          processingResults.mlServerResult &&
          processingResults.mlServerResult.success
        ) {
          console.log(
            `Found ${
              processingResults.mlServerResult.obstructions?.length || 0
            } obstructions in ML result`
          );

          sendSSEEvent(res, "visualization", {
            progress: 80,
            type: "mlRoofSegments",
            segments: processingResults.mlServerResult.roof_segments || [],
            obstructions: processingResults.mlServerResult.obstructions || [],
            panelLayout: processingResults.mlServerResult.panel_layout || [],
            dataUrl: processingResults.mlServerResult.visualization,
            metadata: {
              segmentCount:
                processingResults.mlServerResult.roof_segments?.length || 0,
              obstructionCount:
                processingResults.mlServerResult.obstructions?.length || 0,
              panelCount:
                processingResults.mlServerResult.panel_layout?.length || 0,
              layoutMetadata:
                processingResults.mlServerResult.layout_metadata || {},
              processingTime: processingResults.mlServerResult.processing_time,
              usingCombinedData:
                !!processingResults.combinedVisualizationResult,
              usingFluxData:
                !!processingResults.annualFluxResult &&
                !processingResults.combinedVisualizationResult,
              usingRgbData:
                !!processingResults.rgbResult &&
                !processingResults.annualFluxResult &&
                !processingResults.combinedVisualizationResult,
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
 * NEW: Process Annual Flux layer using the layer manager
 * @param {Object} location - Location object with latitude and longitude
 * @param {Object} dataLayersResponse - Response from the data layers API
 * @param {Object} rgbResults - Processed RGB data to match dimensions (optional)
 * @returns {Promise<Object>} Processed Annual Flux layer data
 */
async function processAnnualFluxLayer(
  location,
  dataLayersResponse,
  rgbResults = null
) {
  try {
    console.log(
      `Processing Annual Flux layer for location: ${location.latitude}, ${location.longitude}`
    );

    if (!dataLayersResponse.annualFluxUrl) {
      throw new Error("Annual Flux URL not available in data layers response");
    }

    // Create processing options
    const radius = 50; // Default radius, adjust as needed
    const options = {
      radius,
      layerUrl: dataLayersResponse.annualFluxUrl,
      maskUrl: dataLayersResponse.maskUrl,
      buildingFocus: true,
      cropToBuilding: true, // Ensure we crop to the building boundary
      fallbackToSynthetic: false,
    };

    console.log(
      "Calling layer manager to process Annual Flux layer with options:",
      {
        ...options,
        layerUrl: options.layerUrl
          ? "[Annual Flux URL present]"
          : "[No Annual Flux URL]",
        maskUrl: options.maskUrl ? "[Mask URL present]" : "[No Mask URL]",
      }
    );

    // Process Annual Flux using the layer manager
    const result = await layerManager.processLayer(
      "annualFlux",
      location,
      options
    );

    console.log("Layer manager result keys:", Object.keys(result));
    console.log("Has processedData:", !!result.processedData);
    if (result.processedData) {
      console.log("ProcessedData keys:", Object.keys(result.processedData));
      console.log("ProcessedData has raster:", !!result.processedData.raster);
    }

    // Get dimensions from processed Annual Flux result
    const fluxWidth =
      result.processedData?.metadata?.dimensions?.width ||
      result.metadata?.dimensions?.width ||
      0;
    const fluxHeight =
      result.processedData?.metadata?.dimensions?.height ||
      result.metadata?.dimensions?.height ||
      0;

    console.log(
      `Annual Flux processing dimensions: ${fluxWidth}x${fluxHeight}`
    );

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

    // CRITICAL: Try to extract raster data from the layer manager result
    let rasterData = null;

    // The layer manager should have processedData with raster
    if (result.processedData && result.processedData.raster) {
      rasterData = result.processedData.raster;
      console.log(
        `Annual Flux raster data extracted: ${rasterData.length} pixels`
      );
    } else {
      console.warn(
        "Annual Flux raster data not available from layer manager result"
      );
      console.log("Available result structure:", {
        hasProcessedData: !!result.processedData,
        processedDataKeys: result.processedData
          ? Object.keys(result.processedData)
          : [],
        hasVisualization: !!result.visualization,
        hasMetadata: !!result.metadata,
      });
    }

    // Return the processed Annual Flux data
    return {
      layerType: "annualFlux",
      bounds: result.bounds,
      buildingBoundaries: result.buildingBoundaries,
      dataUrls: dataUrls,
      // Include raster data if available
      raster: rasterData,
      processedData: result.processedData, // Include full processed data for debugging
      metadata: {
        dimensions: { width: fluxWidth, height: fluxHeight },
        hasMask: !!dataLayersResponse.maskUrl,
        dataRange: result.processedData?.metadata?.dataRange ||
          result.metadata?.dataRange || { min: 0, max: 1800 },
      },
      statistics: result.processedData?.statistics || null,
    };
  } catch (error) {
    console.error("Error processing Annual Flux layer:", error);
    throw new Error(`Failed to process Annual Flux data: ${error.message}`);
  }
}

/**
 * Process DSM layer using the layer manager
 * @param {Object} location - Location object with latitude and longitude
 * @param {Object} dataLayersResponse - Response from the data layers API
 * @param {Object} rgbResults - Processed RGB data to match dimensions
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
    const panelWidth =
      solarPotential.panelWidthMeters ||
      solarPanelAnalysis.STANDARD_PANEL_WIDTH;
    const panelHeight =
      solarPotential.panelHeightMeters ||
      solarPanelAnalysis.STANDARD_PANEL_HEIGHT;
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
 * Process roof segmentation with ML server (original RGB version)
 * @param {Object} rgbResult - Processed RGB data
 * @param {Object} buildingInsights - Building insights data
 * @param {Array} roofSegments - Processed roof segments (optional)
 * @returns {Promise<Object>} ML server processing results
 */
async function processMlServerRoofSegmentation(
  rgbResult,
  buildingInsights,
  roofSegments = null
) {
  try {
    console.log("Processing ML server roof segmentation with RGB data");

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

    // Log the request data (without image data)
    const logData = { ...requestData };
    if (logData.rgb_image) logData.rgb_image = "[RGB IMAGE DATA URL]";

    console.log("ML server request data:", JSON.stringify(logData, null, 2));

    // Send request to ML server
    const startTime = Date.now();
    console.log("Sending request to ML server...");
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      requestData,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 600000, // 60 second timeout for ML processing
      }
    );

    const processingTime = Date.now() - startTime;
    console.log(`ML server response received in ${processingTime}ms`);

    // Process response
    const mlData = mlResponse.data;

    // Add processing time to result
    mlData.processing_time = processingTime;
    mlData.success = true;

    // CRITICAL: Ensure obstructions are present
    if (!mlData.obstructions) {
      mlData.obstructions = [];
    }

    console.log(
      `ML server returned ${mlData.obstructions.length} obstructions`
    );

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
      obstructions: [], // Ensure the obstructions property exists even in error case
    };
  }
}

/**
 * NEW: Process roof segmentation with ML server using Annual Flux data
 * @param {Object} annualFluxResult - Processed Annual Flux data
 * @param {Object} buildingInsights - Building insights data
 * @param {Array} roofSegments - Processed roof segments (optional)
 * @returns {Promise<Object>} ML server processing results
 */
async function processMlServerRoofSegmentationWithFlux(
  annualFluxResult,
  buildingInsights,
  roofSegments = null
) {
  try {
    console.log("Processing ML server roof segmentation with Annual Flux data");

    // Debug the annualFluxResult object thoroughly
    console.log("Annual Flux Result structure received:", {
      hasDataUrls: !!annualFluxResult.dataUrls,
      hasMetadata: !!annualFluxResult.metadata,
      hasBuildingBoundaries: !!annualFluxResult.buildingBoundaries,
      metadataDimensions: annualFluxResult.metadata?.dimensions
        ? `${annualFluxResult.metadata.dimensions.width}x${annualFluxResult.metadata.dimensions.height}`
        : "No dimensions in metadata",
      fullMetadata: JSON.stringify(annualFluxResult.metadata || {}, null, 2),
    });

    // Extract building ID from building insights
    const buildingId = buildingInsights.name || `building_${Date.now()}`;

    // Get Annual Flux image data URL (building-focused)
    const annualFluxImage = annualFluxResult.dataUrls.buildingFocus;
    if (!annualFluxImage) {
      throw new Error(
        "Annual Flux image data URL not available for ML processing"
      );
    }

    // Extract dimensions directly from Annual Flux result
    // Make sure to get the cropped dimensions that were actually used
    const imageWidth = annualFluxResult.metadata?.dimensions?.width;
    const imageHeight = annualFluxResult.metadata?.dimensions?.height;

    // Log the dimensions we're using
    console.log(
      `Using Annual Flux dimensions for ML processing: ${imageWidth}x${imageHeight}`
    );

    // Validate dimensions
    if (!imageWidth || !imageHeight || imageWidth === 0 || imageHeight === 0) {
      throw new Error(
        `Invalid Annual Flux dimensions for ML processing: ${imageWidth}x${imageHeight}`
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

    // Create request data for ML server (using Annual Flux image instead of RGB)
    const requestData = {
      building_id: buildingId,
      rgb_image: annualFluxImage, // UPDATED: Using Annual Flux image instead of RGB
      image_width: imageWidth,
      image_height: imageHeight,
      building_box: pixelCoordinates.buildingBox,
      roof_segments: pixelCoordinates.roofSegments,
      building_center: pixelCoordinates.buildingCenter,
    };

    // Log the request data (without image data)
    const logData = { ...requestData };
    if (logData.rgb_image) logData.rgb_image = "[ANNUAL FLUX IMAGE DATA URL]";

    console.log(
      "ML server request data (with Annual Flux):",
      JSON.stringify(logData, null, 2)
    );

    // Send request to ML server
    const startTime = Date.now();
    console.log("Sending Annual Flux data to ML server...");
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      requestData,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 600000, // 60 second timeout for ML processing
      }
    );

    const processingTime = Date.now() - startTime;
    console.log(`ML server response received in ${processingTime}ms`);

    // Process response
    const mlData = mlResponse.data;

    // Add processing time to result
    mlData.processing_time = processingTime;
    mlData.success = true;

    // CRITICAL: Ensure obstructions are present
    if (!mlData.obstructions) {
      mlData.obstructions = [];
    }

    console.log(
      `ML server returned ${mlData.obstructions.length} obstructions using Annual Flux data`
    );

    return mlData;
  } catch (error) {
    console.error("Error processing with ML server using Annual Flux:", error);

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
      obstructions: [], // Ensure the obstructions property exists even in error case
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
        if (segment.pitch !== undefined) segmentPixel.pitch = segment.pitch;
        if (segment.azimuth !== undefined)
          segmentPixel.azimuth = segment.azimuth;
        if (segment.suitability !== undefined)
          segmentPixel.suitability = segment.suitability;
        if (segment.orientation !== undefined)
          segmentPixel.orientation = segment.orientation;
        if (segment.area !== undefined) segmentPixel.area = segment.area;
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

/**
 * Calculate real-world dimensions from the image and building data
 * @param {Object} imageResult - Processed image data (RGB or Annual Flux)
 * @param {Object} buildingInsights - Building insights data
 * @returns {Object} - Real-world dimensions in meters
 */
function calculateRealWorldDimensions(imageResult, buildingInsights) {
  try {
    // Extract pixel dimensions
    const pixelWidth = imageResult.metadata?.dimensions?.width || 0;
    const pixelHeight = imageResult.metadata?.dimensions?.height || 0;

    if (pixelWidth === 0 || pixelHeight === 0) {
      throw new Error("Invalid pixel dimensions");
    }

    // Get building bounding box from insights
    const boundingBox = buildingInsights.boundingBox;

    if (!boundingBox || !boundingBox.ne || !boundingBox.sw) {
      throw new Error("Building bounding box not available");
    }

    // Calculate real-world width and height using Haversine formula
    const earthRadius = 6371000; // meters

    // Calculate width (east-west distance)
    const dLng =
      ((boundingBox.ne.longitude - boundingBox.sw.longitude) * Math.PI) / 180;
    const lat =
      (((boundingBox.ne.latitude + boundingBox.sw.latitude) / 2) * Math.PI) /
      180;
    const width = earthRadius * Math.cos(lat) * dLng;

    // Calculate height (north-south distance)
    const dLat =
      ((boundingBox.ne.latitude - boundingBox.sw.latitude) * Math.PI) / 180;
    const height = earthRadius * dLat;

    // Calculate meters per pixel
    const metersPerPixelX = width / pixelWidth;
    const metersPerPixelY = height / pixelHeight;

    console.log(
      `Calculated real-world dimensions: ${width.toFixed(
        2
      )}m x ${height.toFixed(2)}m`
    );
    console.log(
      `Meters per pixel: X=${metersPerPixelX.toFixed(
        3
      )}m/px, Y=${metersPerPixelY.toFixed(3)}m/px`
    );

    return {
      width,
      height,
      metersPerPixelX,
      metersPerPixelY,
      pixelWidth,
      pixelHeight,
    };
  } catch (error) {
    console.error(`Error calculating real-world dimensions: ${error.message}`);
    // Return default values based on typical urban aerial imagery resolution
    return {
      width: 50,
      height: 50,
      metersPerPixelX: 0.1,
      metersPerPixelY: 0.1,
      pixelWidth: 500,
      pixelHeight: 500,
    };
  }
}

/**
 * Check if a point is inside a polygon using ray casting algorithm
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {Array} polygon - Array of polygon points {x, y}
 * @returns {boolean} - True if point is inside polygon
 */
function isPointInPolygon(x, y, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    // Check if ray from point crosses edge
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Get bounding box of a polygon
 * @param {Array} polygon - Array of points {x, y}
 * @returns {Object} - Bounding box {minX, minY, maxX, maxY}
 */
function getPolygonBounds(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
  };
}

/**
 * Convert rectangle coordinates to polygon points
 * @param {number} x - X coordinate of top-left corner
 * @param {number} y - Y coordinate of top-left corner
 * @param {number} width - Width of rectangle
 * @param {number} height - Height of rectangle
 * @returns {Array} - Array of points defining the rectangle polygon
 */
function rectangleToPolygon(x, y, width, height) {
  return [
    { x: x, y: y }, // top-left
    { x: x + width, y: y }, // top-right
    { x: x + width, y: y + height }, // bottom-right
    { x: x, y: y + height }, // bottom-left
  ];
}

/**
 * Fit a plane to 3D points using least squares method
 * @param {Array} points - Array of {x,y,z} points
 * @param {Object} dimensions - Real-world dimensions
 * @returns {Object} - Fitted plane parameters
 */
function fitPlaneToPoints(points, dimensions) {
  // Convert pixel coordinates to meters
  const points3D = points.map((p) => ({
    x: p.x * dimensions.metersPerPixelX,
    y: p.y * dimensions.metersPerPixelY,
    z: p.z, // Height in meters
  }));

  // Calculate centroid
  const centroid = {
    x: points3D.reduce((sum, p) => sum + p.x, 0) / points3D.length,
    y: points3D.reduce((sum, p) => sum + p.y, 0) / points3D.length,
    z: points3D.reduce((sum, p) => sum + p.z, 0) / points3D.length,
  };

  // Create covariance matrix components
  let xx = 0,
    xy = 0,
    xz = 0,
    yy = 0,
    yz = 0;

  for (const p of points3D) {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dz = p.z - centroid.z;

    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
  }

  // Solve for normal vector using least squares
  const det_x = yy * xz - xy * yz;
  const det_y = xy * xz - xx * yz;
  const det = xx * yy - xy * xy;

  // Avoid division by zero
  if (Math.abs(det) < 1e-10) {
    // Can't fit plane reliably, return default
    return {
      avgSlope: Math.sqrt(xz * xz + yz * yz),
      normalVector: { x: 0, y: 0, z: 1 },
    };
  }

  const a = det_x / det;
  const b = det_y / det;

  // Normal vector of the plane
  const normalVector = { x: a, y: b, z: 1 };

  // Calculate overall slope
  const avgSlope = Math.sqrt(a * a + b * b);

  return { avgSlope, normalVector };
}

/**
 * Check block slope using DSM data with enhanced global slope matching
 * @param {Array} dsmRaster - DSM raster data
 * @param {number} x - Block top-left X
 * @param {number} y - Block top-left Y
 * @param {number} width - Block width
 * @param {number} height - Block height
 * @param {Object} dimensions - Real-world dimensions
 * @param {number} baselineSlope - Expected slope from roof segment metadata
 * @param {number} maxLocalDeviation - Maximum allowed local deviation in degrees
 * @returns {Object} - Validation result
 */
function checkBlockSlope(
  dsmRaster,
  x,
  y,
  width,
  height,
  dimensions,
  baselineSlope,
  maxLocalDeviation
) {
  // Configurable threshold for global slope deviation (in degrees)
  const MAX_GLOBAL_SLOPE_DEVIATION = 12;

  // If DSM data is missing, assume block is valid
  if (!dsmRaster || !dimensions) {
    return { isValid: true, deviation: 0, avgSlope: baselineSlope };
  }

  try {
    // Sample points in a grid pattern for better slope estimation
    const dsmValues = [];
    const dsmPoints = [];
    let totalValid = 0;

    // Use a 3x3 grid for sampling
    const numSamplesX = 3;
    const numSamplesY = 3;

    for (let sy = 0; sy < numSamplesY; sy++) {
      for (let sx = 0; sx < numSamplesX; sx++) {
        const pointX = x + Math.floor((sx * width) / (numSamplesX - 1));
        const pointY = y + Math.floor((sy * height) / (numSamplesY - 1));

        // Skip if outside image bounds
        if (
          pointX < 0 ||
          pointY < 0 ||
          pointX >= dimensions.pixelWidth ||
          pointY >= dimensions.pixelHeight
        ) {
          continue;
        }

        // Get DSM value at this point
        const index = pointY * dimensions.pixelWidth + pointX;

        if (index >= 0 && index < dsmRaster.length) {
          const value = dsmRaster[index];

          if (value !== undefined && !isNaN(value)) {
            dsmValues.push(value);
            dsmPoints.push({ x: pointX, y: pointY, z: value });
            totalValid++;
          }
        }
      }
    }

    // Need at least 4 valid points to calculate slope reliably
    if (totalValid < 4) {
      return { isValid: true, deviation: 0, avgSlope: baselineSlope };
    }

    // PART 1: Check for local slope consistency (sudden height changes)
    const minHeight = Math.min(...dsmValues);
    const maxHeight = Math.max(...dsmValues);
    const heightDiff = maxHeight - minHeight;

    // Convert height difference to slope angle for local consistency check
    const blockDiagonalLength = Math.sqrt(
      Math.pow(width * dimensions.metersPerPixelX, 2) +
        Math.pow(height * dimensions.metersPerPixelY, 2)
    );

    // Calculate slope based on min/max difference (local consistency)
    const localVarianceSlope = heightDiff / blockDiagonalLength;

    // PART 2: Calculate global average slope using plane fitting
    const { avgSlope, normalVector } = fitPlaneToPoints(dsmPoints, dimensions);

    // Convert slopes to angles for comparison
    const baselineAngle = (Math.atan(baselineSlope) * 180) / Math.PI;
    const localVarianceAngle = (Math.atan(localVarianceSlope) * 180) / Math.PI;
    const avgAngle = (Math.atan(avgSlope) * 180) / Math.PI;

    // Calculate deviations
    const localDeviation = Math.abs(localVarianceAngle - baselineAngle);
    const globalDeviation = Math.abs(avgAngle - baselineAngle);

    // Block is valid if both local and global deviations are acceptable
    const isLocalValid = localDeviation <= maxLocalDeviation;
    const isGlobalValid = globalDeviation <= MAX_GLOBAL_SLOPE_DEVIATION;
    const isValid = isLocalValid && isGlobalValid;

    return {
      isValid,
      localDeviation,
      globalDeviation,
      avgSlope,
      baselineAngle,
      avgAngle,
      type: !isLocalValid
        ? "local_variance"
        : !isGlobalValid
        ? "global_mismatch"
        : "valid",
    };
  } catch (error) {
    console.error(`Error checking block slope: ${error.message}`);
    // Return valid as default in case of error
    return { isValid: true, deviation: 0, avgSlope: baselineSlope };
  }
}

/**
 * Detect obstructions using roof polygons and DSM data
 * Uses a smaller grid size (0.5m) than the solar panel layout for more detailed obstruction detection
 * @param {Array} roofSegments - Roof segments from ML server
 * @param {Object} dsmData - Processed DSM data
 * @param {Object} realWorldDimensions - Real-world dimensions
 * @param {Array} originalRoofSegments - Original roof segments with metadata
 * @returns {Object} - Detailed obstructions
 */
function detectObstructions(
  roofSegments,
  dsmData,
  realWorldDimensions,
  originalRoofSegments
) {
  try {
    console.log("Detecting roof obstructions with 0.5m resolution");

    // Use 0.5m dimension for obstruction detection (finer than panel layout)
    const obstructionWidth = 0.5; // meters
    const obstructionHeight = 0.5; // meters

    // Convert to pixels
    const obstructionWidthPx = Math.round(
      obstructionWidth / realWorldDimensions.metersPerPixelX
    );
    const obstructionHeightPx = Math.round(
      obstructionHeight / realWorldDimensions.metersPerPixelY
    );

    console.log(
      `Obstruction detection dimensions in pixels: ${obstructionWidthPx}px x ${obstructionHeightPx}px`
    );

    // Array to store results
    const obstructions = [];

    // Maximum slope deviation in degrees (for local variance)
    const MAX_SLOPE_DEVIATION = 19; // Stricter than panel layout to catch more obstructions

    // Process each roof segment
    for (let i = 0; i < roofSegments.length; i++) {
      const segment = roofSegments[i];

      // Skip segments without polygons
      if (!segment.polygon || segment.polygon.length < 3) {
        console.log(`Skipping segment ${segment.id} - no valid polygon`);
        continue;
      }

      console.log(`Processing segment ${segment.id} for obstructions`);

      // Find matching original segment for metadata
      const origSegment = originalRoofSegments.find(
        (s) =>
          s.segmentIndex?.toString() === segment.id.replace("segment_", "") ||
          s.id === segment.id
      );

      // Extract metadata from original segment
      const segmentPitch = origSegment?.pitch || segment.pitch || 20; // Default 20 degree pitch
      const segmentAzimuth = origSegment?.azimuth || segment.azimuth || 180; // Default south-facing

      // Calculate baseline slope using segment pitch
      const baselineSlope = Math.tan((segmentPitch * Math.PI) / 180);

      // Get polygon bounding box
      const bounds = getPolygonBounds(segment.polygon);

      // Make sure bounds are within the image
      bounds.minX = Math.max(0, bounds.minX);
      bounds.minY = Math.max(0, bounds.minY);
      bounds.maxX = Math.min(realWorldDimensions.pixelWidth - 1, bounds.maxX);
      bounds.maxY = Math.min(realWorldDimensions.pixelHeight - 1, bounds.maxY);

      // Iterate through bounds in obstruction-sized blocks - use a smaller stride for more detailed detection
      // Use 25% stride for finer detection with overlap
      const strideX = Math.max(1, Math.floor(obstructionWidthPx * 0.25));
      const strideY = Math.max(1, Math.floor(obstructionHeightPx * 0.25));

      for (
        let y = bounds.minY;
        y <= bounds.maxY - obstructionHeightPx;
        y += strideY
      ) {
        for (
          let x = bounds.minX;
          x <= bounds.maxX - obstructionWidthPx;
          x += strideX
        ) {
          // Check if the center of this block is inside the polygon
          const centerX = x + Math.floor(obstructionWidthPx / 2);
          const centerY = y + Math.floor(obstructionHeightPx / 2);

          if (isPointInPolygon(centerX, centerY, segment.polygon)) {
            // Block is inside the polygon - check slope consistency
            const { isValid, localDeviation, globalDeviation, avgSlope, type } =
              checkBlockSlope(
                dsmData.raster,
                x,
                y,
                obstructionWidthPx,
                obstructionHeightPx,
                realWorldDimensions,
                baselineSlope,
                MAX_SLOPE_DEVIATION
              );

            if (!isValid) {
              // Only add if it's an actual obstruction - avoid duplicating nearby detections
              // Check if we already have a similar obstruction nearby
              const isNearExisting = obstructions.some((obs) => {
                const distance = Math.sqrt(
                  Math.pow(obs.x - x, 2) + Math.pow(obs.y - y, 2)
                );
                return (
                  distance < obstructionWidthPx && obs.segmentId === segment.id
                );
              });

              if (!isNearExisting) {
                // Add obstruction with polygon representation
                obstructions.push({
                  id: `obstruction_${segment.id}_${obstructions.length}`,
                  segmentId: segment.id,
                  x,
                  y,
                  width: obstructionWidthPx,
                  height: obstructionHeightPx,
                  type:
                    type === "local_variance"
                      ? "slope_variance"
                      : "slope_mismatch",
                  localDeviation,
                  globalDeviation,
                  // Add polygon representation for obstructions
                  polygon: rectangleToPolygon(
                    x,
                    y,
                    obstructionWidthPx,
                    obstructionHeightPx
                  ),
                  // Add real-world dimensions
                  realWidth: obstructionWidth,
                  realHeight: obstructionHeight,
                });
              }
            }
          }
        }
      }
    }

    console.log(
      `Detected ${obstructions.length} obstructions using 0.5m resolution`
    );

    return {
      obstructions,
      metadata: {
        obstructionCount: obstructions.length,
        obstructionDimensions: {
          width: obstructionWidth,
          height: obstructionHeight,
          widthPx: obstructionWidthPx,
          heightPx: obstructionHeightPx,
        },
      },
    };
  } catch (error) {
    console.error(`Error detecting obstructions: ${error.message}`);
    return {
      obstructions: [],
      metadata: {
        error: error.message,
      },
    };
  }
}

/**
 * Create combined flux+DSM visualization using the CombinedFluxDsmVisualizer
 * @param {Object} annualFluxResult - Processed annual flux data
 * @param {Object} dsmResult - Processed DSM data
 * @returns {Promise<Object>} Combined visualization result
 */
async function createCombinedFluxDsmVisualization(annualFluxResult, dsmResult) {
  try {
    console.log("Creating combined flux+DSM visualization for ML processing");

    // Check if we have the raster data we need
    if (!annualFluxResult.raster) {
      console.error(
        "Annual flux raster data is not available. Available keys:",
        Object.keys(annualFluxResult)
      );

      // If we don't have raster data, we can't create the combined visualization
      // Return a fallback that just uses the annual flux visualization
      console.log("Falling back to using annual flux visualization only");

      return {
        dataUrls: {
          buildingFocus: annualFluxResult.dataUrls.buildingFocus,
          fullImage:
            annualFluxResult.dataUrls.fullImage ||
            annualFluxResult.dataUrls.buildingFocus,
        },
        enhanced: false, // Not actually enhanced since we couldn't combine
        metadata: {
          dimensions: annualFluxResult.metadata.dimensions,
          fallbackMode: true,
          reason: "Annual flux raster data not available for combination",
        },
        bounds: annualFluxResult.bounds,
        buildingBoundaries: annualFluxResult.buildingBoundaries,
      };
    }

    if (!dsmResult.raster) {
      throw new Error("DSM raster data is not available.");
    }

    console.log("Both raster datasets available:");
    console.log(`Flux raster: ${annualFluxResult.raster.length} pixels`);
    console.log(`DSM raster: ${dsmResult.raster.length} pixels`);

    // Create the combined visualizer instance
    const combinedVisualizer = new CombinedFluxDsmVisualizer({
      useEnhancedPalette: true,
    });

    // Create flux processed data object
    const fluxProcessedData = {
      raster: annualFluxResult.raster,
      metadata: {
        width: annualFluxResult.metadata.dimensions.width,
        height: annualFluxResult.metadata.dimensions.height,
        dimensions: annualFluxResult.metadata.dimensions,
        dataRange: annualFluxResult.metadata.dataRange,
      },
      statistics: annualFluxResult.statistics,
      bounds: annualFluxResult.bounds,
      buildingBoundaries: annualFluxResult.buildingBoundaries,
    };

    // Create DSM processed data object
    const dsmProcessedData = {
      raster: dsmResult.raster,
      metadata: {
        width: dsmResult.metadata.dimensions.width,
        height: dsmResult.metadata.dimensions.height,
        dimensions: dsmResult.metadata.dimensions,
        dataRange: dsmResult.metadata.dataRange,
      },
      bounds: dsmResult.bounds,
      buildingBoundaries: dsmResult.buildingBoundaries,
    };

    console.log("Data for combined visualization:");
    console.log(
      `Flux: ${fluxProcessedData.metadata.width}x${fluxProcessedData.metadata.height}`
    );
    console.log(
      `DSM: ${dsmProcessedData.metadata.width}x${dsmProcessedData.metadata.height}`
    );

    // Create the blended visualization
    const blendedResult = await combinedVisualizer.createBlendedVisualization(
      fluxProcessedData,
      dsmProcessedData,
      {
        blendMode: "additive",
        dsmInfluence: 0.35,
        buildingFocus: true,
        paletteName: "IRON",
        quality: 0.95,
      }
    );

    console.log("Combined visualization created successfully");

    // Return in the format expected by the ML processing functions
    return {
      dataUrls: {
        buildingFocus: blendedResult.buildingFocus,
        fullImage: blendedResult.fullImage,
      },
      enhanced: blendedResult.enhanced,
      metadata: blendedResult.metadata || {
        dimensions: fluxProcessedData.metadata.dimensions,
        blendMode: "additive",
        dsmInfluence: 0.35,
        hasDsmBlending: true,
      },
      bounds: fluxProcessedData.bounds,
      buildingBoundaries: fluxProcessedData.buildingBoundaries,
    };
  } catch (error) {
    console.error("Error creating combined flux+DSM visualization:", error);
    throw new Error(
      `Failed to create combined visualization: ${error.message}`
    );
  }
}

/**
 * Helper function to extract raster data from visualization result if not directly available
 * This is a placeholder - you may need to implement this based on your data structure
 * @param {Object} result - Annual flux result
 * @returns {Array} Raster data array
 */
function extractRasterFromVisualization(result) {
  // If raster data is not directly available, you might need to extract it
  // from the processed data or regenerate it. This depends on your data flow.

  // For now, return null and handle in the calling function
  console.warn("Raster data not directly available in annual flux result");
  return null;
}

/**
 * Process roof segmentation with ML server using Combined Flux+DSM visualization
 * @param {Object} combinedVisualizationResult - Combined flux+DSM visualization result
 * @param {Object} buildingInsights - Building insights data
 * @param {Array} roofSegments - Processed roof segments (optional)
 * @returns {Promise<Object>} ML server processing results
 */
async function processMlServerRoofSegmentationWithCombined(
  combinedVisualizationResult,
  buildingInsights,
  roofSegments = null
) {
  try {
    console.log(
      "Processing ML server roof segmentation with Combined Flux+DSM data"
    );

    // Debug the combined result structure
    console.log("Combined Visualization Result structure received:", {
      hasDataUrls: !!combinedVisualizationResult.dataUrls,
      hasMetadata: !!combinedVisualizationResult.metadata,
      hasBuildingBoundaries: !!combinedVisualizationResult.buildingBoundaries,
      enhanced: combinedVisualizationResult.enhanced,
      metadataDimensions: combinedVisualizationResult.metadata?.dimensions
        ? `${combinedVisualizationResult.metadata.dimensions.width}x${combinedVisualizationResult.metadata.dimensions.height}`
        : "No dimensions in metadata",
    });

    // Extract building ID from building insights
    const buildingId = buildingInsights.name || `building_${Date.now()}`;

    // Get Combined Flux+DSM image data URL (building-focused)
    const combinedImage = combinedVisualizationResult.dataUrls.buildingFocus;
    if (!combinedImage) {
      throw new Error(
        "Combined Flux+DSM image data URL not available for ML processing"
      );
    }

    // Extract dimensions from combined visualization result
    const imageWidth = combinedVisualizationResult.metadata?.dimensions?.width;
    const imageHeight =
      combinedVisualizationResult.metadata?.dimensions?.height;

    // Log the dimensions we're using
    console.log(
      `Using Combined Flux+DSM dimensions for ML processing: ${imageWidth}x${imageHeight}`
    );

    // Validate dimensions
    if (!imageWidth || !imageHeight || imageWidth === 0 || imageHeight === 0) {
      throw new Error(
        `Invalid Combined Flux+DSM dimensions for ML processing: ${imageWidth}x${imageHeight}`
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

    // Create request data for ML server (using Combined Flux+DSM image)
    const requestData = {
      building_id: buildingId,
      rgb_image: combinedImage, // Using combined flux+DSM image instead of RGB
      image_width: imageWidth,
      image_height: imageHeight,
      building_box: pixelCoordinates.buildingBox,
      roof_segments: pixelCoordinates.roofSegments,
      building_center: pixelCoordinates.buildingCenter,
    };

    // Log the request data (without image data)
    const logData = { ...requestData };
    if (logData.rgb_image)
      logData.rgb_image = "[COMBINED FLUX+DSM IMAGE DATA URL]";

    console.log(
      "ML server request data (with Combined Flux+DSM):",
      JSON.stringify(logData, null, 2)
    );

    // Send request to ML server
    const startTime = Date.now();
    console.log("Sending Combined Flux+DSM data to ML server...");
    const mlResponse = await axios.post(
      `${ML_SERVER_URL}/api/predict`,
      requestData,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 600000, // 60 second timeout for ML processing
      }
    );

    const processingTime = Date.now() - startTime;
    console.log(`ML server response received in ${processingTime}ms`);

    // Process response
    const mlData = mlResponse.data;

    // Add processing time to result
    mlData.processing_time = processingTime;
    mlData.success = true;

    // CRITICAL: Ensure obstructions are present
    if (!mlData.obstructions) {
      mlData.obstructions = [];
    }

    console.log(
      `ML server returned ${mlData.obstructions.length} obstructions using Combined Flux+DSM data`
    );

    return mlData;
  } catch (error) {
    console.error(
      "Error processing with ML server using Combined Flux+DSM:",
      error
    );

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
      obstructions: [], // Ensure the obstructions property exists even in error case
    };
  }
}

module.exports = router;
