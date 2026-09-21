
(function () {
  "use strict";

  /* ========================================================================
     0. CONFIG
     ======================================================================== */

  const CONFIG = {
    // How many leads should be visibly falling at the same time.
    targetConcurrent: 12,

    // Gap between spawn attempts, randomized within this range (ms).
    // Kept fairly wide + jittered so drops never fall in a visible "beat".
    spawnIntervalMin: 900,
    spawnIntervalMax: 2200,

    // Fall duration range (seconds) — slow motion, and varied so cards
    // don't move in lockstep.
    fallDurationMin: 12,
    fallDurationMax: 24,

    // Horizontal drift over the course of the fall (px, applied both ways).
    driftRange: 70,

    // Total rotation over the course of the fall (deg, applied both ways).
    rotationRange: 22,

    // Size variance.
    scaleMin: 0.82,
    scaleMax: 1.16,


    hardCapConcurrent: 40,
    crmBatchSize: 50,
    crmRefreshIntervalMs: 5 * 60 * 1000,
  };

  const rainStage = document.getElementById("rainStage");
  const fallingCounterLabel = document.getElementById("fallingCounterLabel");
  const totalCounterLabel = document.getElementById("totalCounterLabel");
  const statusText = document.getElementById("statusText");

  let fallingCount = 0;
  let totalSeenCount = 0;
  let spawnTimerId = null;
  let isPageVisible = true;

  const SAMPLE_FIRST_NAMES = [
    "Ava", "Liam", "Noor", "Sofia", "Mateo", "Priya", "Ethan", "Hana",
    "Diego", "Chloe", "Kenji", "Freya", "Omar", "Lucia", "Sam", "Mei",
  ];
  const SAMPLE_LAST_NAMES = [
    "Reyes", "Chen", "Okafor", "Novak", "Silva", "Kapoor", "Larsen",
    "Nakamura", "Rossi", "Haddad", "Murphy", "Yilmaz",
  ];
  const SAMPLE_COMPANIES = [
    "Brightline Labs", "Northwind Retail", "Cedarpoint Health",
    "Vantage Logistics", "Fernway Foods", "Ironclad Robotics",
    "Meridian Capital", "Glasswing Media", "Harborlight Energy",
    "Tandem Analytics",
  ];
  const SAMPLE_STATUSES = ["New", "Contacted", "Qualified", "Unqualified"];
  const SAMPLE_SOURCES = [
    "Web Form", "Referral", "Webinar", "Cold Call", "LinkedIn", "Trade Show",
  ];

  let sampleIdCounter = 1;

  function generateSampleLead() {
    const first = pickRandom(SAMPLE_FIRST_NAMES);
    const last = pickRandom(SAMPLE_LAST_NAMES);
    return {
      id: "sample-" + sampleIdCounter++,
      name: `${first} ${last}`,
      company: pickRandom(SAMPLE_COMPANIES),
      status: pickRandom(SAMPLE_STATUSES),
      source: pickRandom(SAMPLE_SOURCES),
    };
  }


  function mapCrmRecordToLead(record) {
    const name =
      [record.First_Name, record.Last_Name].filter(Boolean).join(" ") ||
      record.Full_Name ||
      "Unnamed Lead";
    return {
      id: record.id,
      name,
      company: record.Company || "—",
      status: record.Lead_Status || "New",
      source: record.Lead_Source || "Unknown",
    };
  }

  // Local cache of real leads pulled from the CRM. The spawn loop draws
  // from this instead of calling the API per card — see refreshLeadPool().
  let leadPool = [];
  let leadPoolCursor = 0;
  const isEmbeddedInCrm = !!(window.ZOHO && window.ZOHO.CRM && window.ZOHO.CRM.API);

  function refreshLeadPool() {
    if (!isEmbeddedInCrm) {
      return Promise.resolve();
    }
    console.log("Lead Rainfall: requesting Leads from CRM…");
    return ZOHO.CRM.API.getAllRecords({
      Entity: "Leads",
      sort_order: "desc",
      sort_by: "Created_Time",
      page: 1,
      per_page: CONFIG.crmBatchSize,
    })
      .then(function (response) {
        console.log("Lead Rainfall: CRM response", response);
        const records = (response && response.data) || [];
        if (records.length) {
          leadPool = records.map(mapCrmRecordToLead);
          leadPoolCursor = 0;
          console.log("Lead Rainfall: cached " + leadPool.length + " leads");
        } else {
          console.warn(
            "Lead Rainfall: CRM call succeeded but returned no Lead records " +
              "(empty module, filtered out by scope, or a malformed response). " +
              "Falling back to sample data."
          );
        }
      })
      .catch(function (err) {
        console.error("Lead Rainfall: failed to refresh leads from CRM", err);
      });
  }


  function fetchLeads(count) {
    const leads = [];
    for (let i = 0; i < count; i++) {
      if (leadPool.length > 0) {
        leads.push(leadPool[leadPoolCursor % leadPool.length]);
        leadPoolCursor++;
      } else {
        leads.push(generateSampleLead());
      }
    }
    return Promise.resolve(leads);
  }


  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  const CARD_VARIANTS = ["a", "b", "c", "d"];
  let variantCursor = 0;
  function nextVariant() {
    const v = CARD_VARIANTS[variantCursor % CARD_VARIANTS.length];
    variantCursor++;
    return v;
  }

  function statusBadgeClass(status) {
    switch (status) {
      case "New": return "badge--new";
      case "Contacted": return "badge--contacted";
      case "Qualified": return "badge--qualified";
      case "Unqualified": return "badge--unqualified";
      default: return "badge--new";
    }
  }

  function statusAvatarColor(status) {
    switch (status) {
      case "New": return "var(--status-new)";
      case "Contacted": return "var(--status-contacted)";
      case "Qualified": return "var(--status-qualified)";
      case "Unqualified": return "var(--status-unqualified)";
      default: return "var(--status-new)";
    }
  }

  function initials(name) {
    return name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("");
  }

  function createLeadDrop(lead) {
    if (fallingCount >= CONFIG.hardCapConcurrent) {
      return; // safety valve, should not normally be hit
    }

    const drop = document.createElement("div");
    drop.className = "lead-drop";

    // --- randomized motion, set as CSS custom properties -----------------
    const startXvw = randomBetween(2, 92); // keep cards mostly on-stage
    const drift = randomBetween(-CONFIG.driftRange, CONFIG.driftRange);
    const rotation = randomBetween(-CONFIG.rotationRange, CONFIG.rotationRange);
    const duration = randomBetween(CONFIG.fallDurationMin, CONFIG.fallDurationMax);
    const scale = randomBetween(CONFIG.scaleMin, CONFIG.scaleMax);

    drop.style.setProperty("--start-x", startXvw + "vw");
    drop.style.setProperty("--drift", drift + "px");
    drop.style.setProperty("--rot", rotation + "deg");
    drop.style.setProperty("--fall-dur", duration + "s");
    drop.style.setProperty("--scale", scale.toFixed(2));

    // --- card content ------------------------------------------------------
    const variant = nextVariant();
    const card = document.createElement("div");
    card.className = `lead-card lead-card--variant-${variant}`;
    card.style.setProperty("--avatar-bg", statusAvatarColor(lead.status));

    card.innerHTML = `
      <div class="lead-card__top">
        <div class="lead-card__avatar">${escapeHtml(initials(lead.name))}</div>
        <div class="lead-card__name">${escapeHtml(lead.name)}</div>
      </div>
      <div class="lead-card__company">${escapeHtml(lead.company)}</div>
      <div class="lead-card__meta">
        <span class="lead-card__badge ${statusBadgeClass(lead.status)}">${escapeHtml(lead.status)}</span>
        <span class="lead-card__source">${escapeHtml(lead.source)}</span>
      </div>
    `;

    drop.appendChild(card);
    rainStage.appendChild(drop);

    fallingCount++;
    totalSeenCount++;
    updateCounters();

    // --- cleanup: remove from DOM once the fall animation finishes -------
    let removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      drop.remove();
      fallingCount = Math.max(0, fallingCount - 1);
      updateCounters();
    }

    drop.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, (duration + 1) * 1000);
  }

  function updateCounters() {
    fallingCounterLabel.textContent = `Leads Falling: ${fallingCount}`;
    totalCounterLabel.textContent = `Total Seen: ${totalSeenCount}`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  function scheduleNextSpawn() {
    const delay = randomBetween(CONFIG.spawnIntervalMin, CONFIG.spawnIntervalMax);
    spawnTimerId = setTimeout(spawnTick, delay);
  }

  function spawnTick() {
    if (isPageVisible && fallingCount < CONFIG.targetConcurrent) {
      fetchLeads(1).then((leads) => {
        leads.forEach(createLeadDrop);
      });
    }
    scheduleNextSpawn();
  }

  document.addEventListener("visibilitychange", function () {
    isPageVisible = !document.hidden;
    rainStage.style.setProperty(
      "--play-state",
      isPageVisible ? "running" : "paused"
    );
    document.querySelectorAll(".lead-drop").forEach((el) => {
      el.style.animationPlayState = isPageVisible ? "running" : "paused";
    });
  });

  function seedStage() {
    // Seed the stage with an initial burst so it doesn't look empty on load.
    const initialBurst = Math.min(6, CONFIG.targetConcurrent);
    fetchLeads(initialBurst).then((leads) => {
      leads.forEach((lead, i) => {
        // slight stagger so the first cards don't all pop in at once
        setTimeout(() => createLeadDrop(lead), i * 220);
      });
    });
    scheduleNextSpawn();
  }

  function startWidget() {
    if (isEmbeddedInCrm) {
      statusText.textContent = "Loading leads from Zoho CRM…";
      // Warm the cache with real records before we start dropping cards,
      // then keep it fresh on a timer.
      refreshLeadPool().then(function () {
        if (leadPool.length > 0) {
          statusText.textContent = "Connected to Zoho CRM · showing live Leads";
        } else {
          statusText.textContent =
            "Connected to Zoho CRM, but no Leads were returned — showing sample data. Check the console for details.";
        }
        seedStage();
      });
      setInterval(refreshLeadPool, CONFIG.crmRefreshIntervalMs);
    } else {
      // Standalone / local preview mode — no Zoho SDK on the page.
      statusText.textContent = "Preview mode (sample data) · load inside Zoho CRM to go live";
      seedStage();
    }
  }

  // Guard against starting twice if both init() and "PageLoad" fire.
  let widgetStarted = false;
  function startWidgetOnce(reason) {
    if (widgetStarted) return;
    widgetStarted = true;
    console.log("Lead Rainfall: starting widget (" + reason + ")");
        startWidget();
    }

  if (window.ZOHO && window.ZOHO.embeddedApp) {
    window.ZOHO.embeddedApp.on("PageLoad", function () {
      startWidgetOnce("PageLoad event");
    });
    window.ZOHO.embeddedApp
      .init()
      .then(function () {
        startWidgetOnce("init() resolved");
      })
      .catch(function (err) {
        console.error("Lead Rainfall: ZOHO.embeddedApp.init() failed", err);
        statusText.textContent = "Could not connect to Zoho CRM — showing sample data.";
        startWidgetOnce("init() failed, falling back");
      });

    setTimeout(function () {
      startWidgetOnce("timeout fallback");
    }, 4000);
  } else {
    startWidgetOnce("no ZOHO SDK detected");
  }
})();