/**
 * SFDAASS Fire Detection Engine
 * Implements threshold evaluation, sensor fusion, severity classification,
 * false-alarm prevention, and suppression decision logic.
 */

const logger = require('./logger');

// Pending confirmations: deviceId -> { timer, readings[] }
const pendingConfirmations = new Map();

/**
 * Get current thresholds (from env or defaults)
 */
function getThresholds() {
  return {
    smoke_warning:      parseFloat(process.env.SMOKE_WARNING_THRESHOLD  || 300),
    smoke_critical:     parseFloat(process.env.SMOKE_CRITICAL_THRESHOLD || 500),
    temp_warning:       parseFloat(process.env.TEMP_WARNING_THRESHOLD   || 60),
    temp_critical:      parseFloat(process.env.TEMP_CRITICAL_THRESHOLD  || 100),
    gas_warning:        parseFloat(process.env.GAS_WARNING_THRESHOLD    || 400),
    gas_critical:       parseFloat(process.env.GAS_CRITICAL_THRESHOLD   || 700),
    confirm_duration_ms: parseInt(process.env.FIRE_CONFIRM_DURATION_MS || 5000),
  };
}

/**
 * Evaluate sensor reading against thresholds
 * Returns: { level: 'normal'|'warning'|'critical', reasons[], score }
 */
function evaluateReading(reading) {
  const T = getThresholds();
  const reasons = [];
  let score = 0;

  const { smoke_ppm, temperature_c, gas_ppm, flame_detected } = reading;

  // Smoke evaluation
  if (smoke_ppm != null) {
    if (smoke_ppm >= T.smoke_critical) {
      score += 40; reasons.push(`Smoke CRITICAL: ${smoke_ppm}ppm (≥${T.smoke_critical})`);
    } else if (smoke_ppm >= T.smoke_warning) {
      score += 20; reasons.push(`Smoke WARNING: ${smoke_ppm}ppm (≥${T.smoke_warning})`);
    }
  }

  // Temperature evaluation
  if (temperature_c != null) {
    if (temperature_c >= T.temp_critical) {
      score += 40; reasons.push(`Temp CRITICAL: ${temperature_c}°C (≥${T.temp_critical})`);
    } else if (temperature_c >= T.temp_warning) {
      score += 20; reasons.push(`Temp WARNING: ${temperature_c}°C (≥${T.temp_warning})`);
    }
  }

  // Gas evaluation
  if (gas_ppm != null) {
    if (gas_ppm >= T.gas_critical) {
      score += 30; reasons.push(`Gas CRITICAL: ${gas_ppm}ppm (≥${T.gas_critical})`);
    } else if (gas_ppm >= T.gas_warning) {
      score += 15; reasons.push(`Gas WARNING: ${gas_ppm}ppm (≥${T.gas_warning})`);
    }
  }

  // Flame sensor bonus
  if (flame_detected) {
    score += 50; reasons.push('Flame sensor triggered');
  }

  // Classify severity
  let level = 'normal';
  if (score >= 60) level = 'critical';
  else if (score >= 20) level = 'warning';

  return { level, score, reasons };
}

/**
 * Determine severity string for DB
 */
function getSeverity(evaluation) {
  if (evaluation.level === 'critical') return 'critical';
  if (evaluation.level === 'warning') return 'warning';
  return 'low';
}

/**
 * Multi-sensor fusion fire confirmation.
 * Requires abnormal readings to persist for CONFIRM_DURATION_MS.
 * 
 * Calls onConfirmed(deviceId, severity, latestReading) when fire confirmed.
 * Calls onCancelled(deviceId) when readings return to normal.
 */
function startConfirmation(deviceId, reading, evaluation, callbacks) {
  const T = getThresholds();

  // Clear if already pending
  if (pendingConfirmations.has(deviceId)) {
    const pending = pendingConfirmations.get(deviceId);
    pending.readings.push(reading);
    return; // timer already running
  }

  logger.info(`🔎 Fire confirmation started for ${deviceId} (score=${evaluation.score})`);

  const timer = setTimeout(() => {
    const pending = pendingConfirmations.get(deviceId);
    if (!pending) return;

    // Check if readings stayed elevated throughout confirmation window
    const allElevated = pending.readings.every(r => {
      const ev = evaluateReading(r);
      return ev.level !== 'normal';
    });

    if (allElevated && pending.readings.length >= 2) {
      const latestReading = pending.readings[pending.readings.length - 1];
      const latestEval = evaluateReading(latestReading);
      const severity = getSeverity(latestEval);
      logger.warn(`🔥 FIRE CONFIRMED for device ${deviceId} — severity: ${severity}`);
      callbacks.onConfirmed(deviceId, severity, latestReading, latestEval);
    } else {
      logger.info(`✅ False alarm prevented for ${deviceId} — readings normalised`);
      if (callbacks.onCancelled) callbacks.onCancelled(deviceId);
    }

    pendingConfirmations.delete(deviceId);
  }, T.confirm_duration_ms);

  pendingConfirmations.set(deviceId, { timer, readings: [reading] });
}

/**
 * Cancel pending confirmation if readings return to normal
 */
function cancelConfirmation(deviceId) {
  if (pendingConfirmations.has(deviceId)) {
    const pending = pendingConfirmations.get(deviceId);
    clearTimeout(pending.timer);
    pendingConfirmations.delete(deviceId);
    logger.info(`✅ Confirmation cancelled for ${deviceId} — readings normalised`);
    return true;
  }
  return false;
}

/**
 * Determine if suppression should activate automatically
 */
function shouldActivateSuppression(severity, insideGeofence) {
  const autoActivate = process.env.SUPPRESSION_AUTO !== 'false';
  const criticalOnly = process.env.SUPPRESSION_CRITICAL_ONLY !== 'false';

  if (!autoActivate) return false;
  if (!insideGeofence) return false; // Only suppress within geofence
  if (criticalOnly && severity !== 'critical') return false;
  return true;
}

module.exports = {
  getThresholds,
  evaluateReading,
  getSeverity,
  startConfirmation,
  cancelConfirmation,
  shouldActivateSuppression,
};
