const express = require("express");
const router = express.Router();
const scanController = require("../controllers/scanController");

// Initiate a new scan
router.post("/", scanController.initiateScan);

// Get scan status
router.get("/:jobId/status", scanController.getScanStatus);

// Get scan results
router.get("/:jobId/results", scanController.getScanResults);

module.exports = router;
