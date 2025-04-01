/**
 * Groups activity logs into meaningful chunks of activity
 * Handles keyboard events, mouse events, and window switches
 */

const ACTIVITY_TYPES = {
  KEYBOARD: 'keyboard',
  MOUSE: 'mouse',
  WINDOW_SWITCH: 'window_switch',
  INACTIVITY: 'inactivity',
  PENDING_VALIDATION: 'pending_validation',
  AUTO_CLOCK_OUT: 'auto_clock_out',
  CLOCK_IN: 'clock_in',
  CLOCK_OUT: 'clock_out'
};

const GROUP_TIME_THRESHOLD = 2 * 60 * 1000; // 2 minutes in milliseconds

/**
 * Creates a unique group ID from start and end times
 * @param {Date} startTime 
 * @param {Date} endTime 
 * @returns {string}
 */
function createGroupId(startTime, endTime) {
  return `${startTime.toISOString()}_${endTime.toISOString()}`;
}

/**
 * Groups activities into meaningful chunks
 * @param {Array} activities - Array of activity log entries
 * @returns {Array} Grouped activities
 */
function groupActivities(activities) {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }

  const groups = [];
  let currentGroup = null;
  let currentApp = null;

  // Add clock in event at the start
  const clockInTime = new Date(activities[0].timestamp);
  groups.push({
    type: 'clock_in',
    startTime: clockInTime,
    endTime: clockInTime,
    duration: 0,
    groupId: createGroupId(clockInTime, clockInTime)
  });

  activities.forEach((activity, index) => {
    const timestamp = new Date(activity.timestamp);
    const isActivityType = [
      ACTIVITY_TYPES.KEYBOARD,
      ACTIVITY_TYPES.MOUSE,
      ACTIVITY_TYPES.WINDOW_SWITCH
    ].includes(activity.type);

    // Update current app when window switches
    if (activity.type === ACTIVITY_TYPES.WINDOW_SWITCH) {
      currentApp = activity.details?.appName || 'Unknown Application';
    }

    // Determine if we should start a new group
    const shouldStartNewGroup = (
      !currentGroup || 
      !isActivityType ||
      (timestamp - new Date(currentGroup.endTime)) > GROUP_TIME_THRESHOLD ||
      (activity.type === ACTIVITY_TYPES.WINDOW_SWITCH && 
       activity.details?.appName !== currentGroup?.app)
    );

    if (shouldStartNewGroup) {
      if (currentGroup) {
        groups.push(formatGroup(currentGroup));
      }

      if (isActivityType) {
        currentGroup = {
          type: 'activity',
          startTime: timestamp,
          endTime: timestamp,
          app: currentApp || 'Unknown Application',
          events: {
            keyboard: 0,
            mouse: 0
          }
        };
      } else {
        // Non-activity events get their own group
        const duration = activity.details?.duration || 0;
        groups.push({
          type: activity.type,
          startTime: timestamp,
          endTime: new Date(timestamp.getTime() + (duration * 1000)), // Convert duration to milliseconds
          duration: duration,
          details: activity.details,
          groupId: createGroupId(timestamp, new Date(timestamp.getTime() + (duration * 1000)))
        });
        currentGroup = null;
        return;
      }
    }

    if (currentGroup) {
      currentGroup.endTime = timestamp;
      
      switch (activity.type) {
        case ACTIVITY_TYPES.KEYBOARD:
          currentGroup.events.keyboard++;
          break;
        
        case ACTIVITY_TYPES.MOUSE:
          currentGroup.events.mouse++;
          break;
      }
    }
  });

  // Don't forget the last group
  if (currentGroup) {
    groups.push(formatGroup(currentGroup));
  }

  // Add clock out event at the end if session is completed
  const lastActivity = activities[activities.length - 1];
  if (lastActivity && lastActivity.type !== 'auto_clock_out') {
    const clockOutTime = new Date(lastActivity.timestamp);
    groups.push({
      type: 'clock_out',
      startTime: clockOutTime,
      endTime: clockOutTime,
      duration: 0,
      groupId: createGroupId(clockOutTime, clockOutTime)
    });
  }

  return groups;
}

/**
 * Formats a group for API response
 * @param {Object} group - The activity group to format
 * @returns {Object} Formatted group
 */
function formatGroup(group) {
  if (group.type !== 'activity') {
    return group;
  }

  const duration = (new Date(group.endTime) - new Date(group.startTime)) / 1000; // Convert to seconds
  const totalEvents = group.events.keyboard + group.events.mouse;

  return {
    type: 'activity',
    startTime: group.startTime,
    endTime: group.endTime,
    duration,
    app: group.app,
    groupId: createGroupId(group.startTime, group.endTime),
    summary: {
      totalEvents,
      keyboard: group.events.keyboard,
      mouse: group.events.mouse
    },
    description: formatDescription(group),
    hasDetails: totalEvents > 0
  };
}

/**
 * Creates a human-readable description of the activity group
 * @param {Object} group - The activity group
 * @returns {string} Human-readable description
 */
function formatDescription(group) {
  const parts = [];
  
  if (group.events.keyboard > 0) {
    parts.push(`${group.events.keyboard} keystrokes`);
  }
  
  if (group.events.mouse > 0) {
    parts.push(`${group.events.mouse} mouse clicks`);
  }

  if (parts.length === 0) {
    parts.push('activity');
  }

  return `${parts.join(', ')} in ${group.app}`;
}

module.exports = {
  groupActivities,
  ACTIVITY_TYPES,
  createGroupId
}; 