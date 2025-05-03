const scanService = require("../../services/scan/scanService");

// Initialize a new solar scan job
exports.initiateScan = async (req, res) => {
  try {
    const { buildingId, location, clientId } = req.body;

    // Validate request parameters
    if (!buildingId || !location || !clientId) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    // Create a new scan job
    const job = await scanService.createScanJob(buildingId, location, clientId);

    return res.status(201).json({
      success: true,
      message: "Scan job created successfully",
      data: {
        jobId: job.id,
        status: job.status,
      },
    });
  } catch (error) {
    console.error("Error initiating scan:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate scan",
      error: error.message,
    });
  }
};

// Get the current status of a scan job
exports.getScanStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Get job status
    const jobStatus = await scanService.getScanJobStatus(jobId);

    if (!jobStatus) {
      return res.status(404).json({
        success: false,
        message: "Scan job not found",
      });
    }

    return res.json({
      success: true,
      data: jobStatus,
    });
  } catch (error) {
    console.error("Error getting scan status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get scan status",
      error: error.message,
    });
  }
};

// Get scan results (if complete)
exports.getScanResults = async (req, res) => {
  try {
    const { jobId } = req.params;

    // Get job results
    const result = await scanService.getScanJobResults(jobId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Scan job not found",
      });
    }

    if (result.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Scan job is still processing",
        data: {
          status: result.status,
          progress: result.progress,
        },
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error getting scan results:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get scan results",
      error: error.message,
    });
  }
};
