console.log("🧠 ui.js loaded");

let cancelled = false;

// Market-relative review banding, measured against THIS pull.
// - "thin": well below the market median (likely inactive/new/too small)
// - "dominant": a true top-of-market outlier (top DOMINANT_PCT by review count) - a market king
//   that likely has marketing handled and feels little pain. Strong-but-approachable businesses
//   in the upper-middle are deliberately left as "workable".
const THIN_MULT = 0.3;        // below 0.3x median -> thin
const DOMINANT_PCT = 90;      // at/above the 90th percentile (top 10%) -> dominant
const DOMINANT_MEDIAN_FLOOR = 2.0; // and must be at least 2x median, so tiny uniform markets do not misfire

function percentileValue(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const k = (sortedAsc.length - 1) * (p / 100);
  const f = Math.floor(k), c = Math.ceil(k);
  if (f === c) return sortedAsc[k];
  return sortedAsc[f] * (c - k) + sortedAsc[c] * (k - f);
}

function computeMarketStats(leads) {
  const counts = leads
    .map(l => parseInt(l.reviews, 10))
    .filter(n => !isNaN(n) && n >= 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return { median: 0, count: 0, domLine: Infinity };
  const mid = Math.floor(counts.length / 2);
  const median = counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2;
  // Dominant line: the higher of the 90th-percentile value and the 2x-median floor.
  const domLine = Math.max(percentileValue(counts, DOMINANT_PCT), median * DOMINANT_MEDIAN_FLOOR);
  return { median, count: counts.length, domLine };
}

// Returns a band key for a lead given market stats: "prime" | "work" | "leader" | "thin" | ""
function reviewBand(reviews, stats) {
  const r = parseInt(reviews, 10);
  if (isNaN(r)) return "";
  if (!stats || !stats.median || stats.median < 1) return "work";
  if (r < stats.median * THIN_MULT) return "thin";
  if (r >= stats.domLine) return "leader";
  // Within workable: the upper-middle (>= median) are "prime" targets, lower-middle are "work"
  return r >= stats.median ? "prime" : "work";
}

const BAND_LABEL = { prime:"Prime", work:"Workable", leader:"Leader", thin:"Thin", "":"" };
const BAND_TITLE = {
  prime:"Established and in the strong middle-upper of this market. Best first-client targets.",
  work:"Real and workable, on the lighter side of this market. Solid targets.",
  leader:"Top-of-market leader. Likely has marketing handled and feels little pain. Lower priority, still worth a look.",
  thin:"Well below the market median. May be inactive, brand new, or too small.",
  "":""
};
// Sort priority: prime first, then work, then leader, then thin, then unknown
const BAND_ORDER = { prime:0, work:1, leader:2, thin:3, "":4 };

function blipHTML(band) {
  if (!band) return "-";
  return `<span class="blip ${band}" title="${BAND_TITLE[band]}">${BAND_LABEL[band]}</span>`;
}


// ===== Qualification + guidance config =====
const POP_FLOOR = 27000; // markets under this get a soft "too small" nudge
const REVIEW_MIN = 8;    // fewer than this often means a dead/unestablished listing
const REVIEW_MAX = 400;  // way more than this often means they are already dominant

function normCity(s) {
  return (s || "")
    .split(",")[0]                         // drop ", MI" / ", TX" etc.
    .normalize("NFKD").replace(/[^\x00-\x7F]/g, "") // strip accents
    .toLowerCase().trim()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

// Returns {pop, country} or null. Cached in chrome.storage for reuse.
function lookupCityPop(cityRaw) {
  const key = normCity(cityRaw);
  if (!key || typeof window.CITY_POP === "undefined") return null;
  const hit = window.CITY_POP[key];
  return hit ? { pop: hit[0], country: hit[1] } : null;
}

function buildNicheDropdown() {
  const sel = document.getElementById("niche");
  if (!sel || typeof window.NICHES === "undefined") return;
  sel.innerHTML = "";
  const groups = {1:"⭐ Top Tier (best fit)", 2:"Solid", 3:"Situational"};
  for (const tier of [1,2,3]) {
    const og = document.createElement("optgroup");
    og.label = groups[tier];
    window.NICHES.filter(n => n.tier === tier)
      .sort((a,b) => (a.rank ?? 0) - (b.rank ?? 0))
      .forEach(n => {
        const o = document.createElement("option");
        o.value = n.name;
        o.textContent = n.name;
        o.dataset.tier = n.tier;
        o.dataset.why = n.why || "";
        og.appendChild(o);
      });
    if (og.children.length) sel.appendChild(og);
  }
  updateNicheGuidance();
}

function restoreLastSearch() {
  chrome.storage.local.get("lastSearch", ({ lastSearch }) => {
    if (!lastSearch) return;
    const sel = document.getElementById("niche");
    const city = document.getElementById("location");
    if (sel && lastSearch.niche) {
      // select the matching option if it exists
      const opt = Array.from(sel.options).find(o => o.value === lastSearch.niche);
      if (opt) { sel.value = lastSearch.niche; updateNicheGuidance(); }
    }
    if (city && lastSearch.city) {
      city.value = lastSearch.city;
      checkCityWarning();
    }
  });
}

function updateNicheGuidance() {
  const sel = document.getElementById("niche");
  const why = document.getElementById("nicheWhy");
  const nudge = document.getElementById("nicheNudge");
  if (!sel || !sel.selectedOptions.length) return;
  const opt = sel.selectedOptions[0];
  const tier = parseInt(opt.dataset.tier, 10);
  why.textContent = opt.dataset.why || "";
  if (tier === 1) {
    nudge.style.display = "none";
  } else if (tier === 2) {
    nudge.style.display = "block";
    nudge.textContent = "This niche can work well. The Top Tier niches tend to convert faster and pay more, so consider one of those first.";
  } else {
    nudge.style.display = "block";
    nudge.textContent = "This is a situational pick. It can work in the right market, but the Top Tier niches are the recommended path for your first clients.";
  }
}

function looksLikeRealPlace(cityPart) {
  // Well-formed: only letters/spaces/hyphens/apostrophes, 3+ chars, at least one vowel,
  // and not an obvious keyboard-mash. Conservative on purpose.
  const c = (cityPart || "").trim();
  if (c.length < 3) return false;
  if (!/^[A-Za-z][A-Za-z '\-]*$/.test(c)) return false;
  if (!/[aeiou]/i.test(c)) return false;
  return true;
}

function checkCityWarning() {
  const cityInput = document.getElementById("location");
  const warn = document.getElementById("cityWarn");
  if (!cityInput || !warn) return;
  const raw = cityInput.value.trim();
  if (!raw) { warn.style.display = "none"; return; }

  const cityPart = raw.split(",")[0].trim();
  const hasQualifier = raw.includes(","); // e.g. "Cut and Shoot, Texas"
  const res = lookupCityPop(raw);

  if (res && res.pop < POP_FLOOR) {
    // Known small market: confident, factual warning
    warn.style.display = "block";
    warn.textContent = `Heads up: ${cityPart} looks like a smaller market (about ${res.pop.toLocaleString()} people). Consider a bigger nearby city for more prospects.`;
  } else if (!res && hasQualifier && looksLikeRealPlace(cityPart)) {
    // Not in our larger-city list, but typed like a real place with a state/country.
    // Soft, uncertain warning (we do not know the actual population).
    warn.style.display = "block";
    warn.textContent = `We don't recognize ${cityPart} as a larger market. If it's a small town, you'll likely get more prospects from a bigger nearby city.`;
  } else {
    // Known large market, or unrecognized/no-qualifier input -> stay silent (fail open)
    warn.style.display = "none";
  }
}


function setProgLabel(txt){ const l=document.getElementById("progLabel"); if(l) l.textContent = txt; }
function updateProgress(current, total, label) {
  const container = document.getElementById("progressContainer");
  const bar = document.getElementById("progressBar");
  if (label) setProgLabel(`${label}  ${current}/${total}`);
  if (cancelled) {
    // 🔻 Hide and reset progress bar immediately if cancelled
    container.style.display = "none";
    bar.style.width = "0%";
    return;
  }

  // Show and update progress
  container.style.display = "block";
  const percent = Math.round((current / total) * 100);
  bar.style.width = percent + "%";

  // If done and not cancelled, hide after short delay
  if (current >= total) {
    setTimeout(() => {
      if (!cancelled) {
        container.style.display = "none";
        bar.style.width = "0%";
      }
    }, 800);
  }
}


document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ action: "registerUITab" });

  buildNicheDropdown();
  restoreLastSearch();
  document.getElementById("niche")?.addEventListener("change", updateNicheGuidance);
  document.getElementById("location")?.addEventListener("input", checkCityWarning);
  document.getElementById("location")?.addEventListener("blur", checkCityWarning);

  const searchBtn = document.getElementById("search-btn");
  const nicheInput = document.getElementById("niche");
  const cityInput = document.getElementById("location");

  if (searchBtn && nicheInput && cityInput) {
    searchBtn.addEventListener("click", () => {
      cancelled = false;
      const niche = nicheInput.value.trim();
      const city = cityInput.value.trim();
      if (!niche || !city) {
        alert("Please enter both niche and city.");
        return;
      }
      chrome.storage.local.set({ lastSearch: { niche, city } });
      const query = encodeURIComponent(`${niche} in ${city}`);
      const mapsURL = `https://www.google.com/maps/search/${query}`;
      chrome.runtime.sendMessage({ action: "openMaps", url: mapsURL });
    });
  }

  function fetchLeadProfileHTML(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "fetchHTML", url }, (response) => {
      resolve(response.html || "");
    });
  });
}

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showLeads" && Array.isArray(request.leads)) {
      console.log("📥 Received showLeads message");
      const section = document.getElementById("leadsSection");
      const tableBody = document.getElementById("leadsTableTBody");

      section.style.display = "block";
      tableBody.innerHTML = "";

      const stats = computeMarketStats(request.leads);
      renderMarketRead(request.leads, stats);
      const sorted = sortLeadsByBand(request.leads, stats);
      sorted.forEach(lead => {
        const band = reviewBand(lead.reviews, stats);
        const row = document.createElement("tr");
        if (band === "thin" || band === "leader") row.classList.add("dim");
        if (band === "prime") row.classList.add("prime-row");
        row.innerHTML = `
          <td class="name">${lead.name}</td>
          <td>${blipHTML(band)}</td>
          <td class="mono">${lead.ownerName || "-"}</td>
          <td class="mono">${(lead.rating !== "" && lead.rating != null) ? lead.rating : "-"}</td>
          <td class="rev">${(lead.reviews !== "" && lead.reviews != null) ? lead.reviews : "-"}</td>
          <td><a href="${lead.profile}" target="_blank">View</a></td>
          <td style="word-break:break-word;max-width:200px;white-space:normal;"><a href="${lead.website}" target="_blank">${lead.website || "-"}</a></td>
          <td class="mono">${lead.phone || "-"}</td>
          <td class="mono">${lead.email || "-"}</td>
        `;
        tableBody.appendChild(row);
      });
    }
  });

//Start the email search
document.addEventListener("DOMContentLoaded", () => {
  const emailBtn = document.getElementById("add-emails-btn");
  if (emailBtn) {
    emailBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "startEmailSearch" });
    });
  }
});

  // Respond to message to display spreadsheet
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "showSpreadsheet") {
      console.log(request);
      restoreLastSearch(); // reflect the niche/city that was just swept, even on a reused tab
      chrome.storage.local.set({ leads: request.leads }, () => {
        displayLeadsTable();
      });
    }
  });
});


function renderMarketRead(leads, stats) {
  const readout = document.getElementById("readout");
  const row = document.getElementById("statsRow");
  if (!readout || !row) return;
  const withRev = leads.filter(l => !isNaN(parseInt(l.reviews,10)));
  let prime=0, leader=0;
  for (const l of leads) {
    const b = reviewBand(l.reviews, stats);
    if (b === "prime") prime++;
    else if (b === "leader") leader++;
  }
  const med = stats && stats.median ? Math.round(stats.median) : "-";
  row.innerHTML = `
    <div class="stat"><span class="n">${leads.length}</span><span class="k">Leads</span></div>
    <div class="stat"><span class="n">${med}</span><span class="k">Median Reviews</span></div>
    <div class="stat prime"><span class="n">${prime}</span><span class="k">Prime Targets</span></div>
    <div class="stat leader"><span class="n">${leader}</span><span class="k">Market Leaders</span></div>
  `;
  readout.style.display = "block";
}

function sortLeadsByBand(leads, stats) {
  return [...leads].sort((a,b) => {
    const oa = BAND_ORDER[reviewBand(a.reviews, stats)] ?? 4;
    const ob = BAND_ORDER[reviewBand(b.reviews, stats)] ?? 4;
    if (oa !== ob) return oa - ob;
    // within same band, higher reviews first (except leaders where we also just show them)
    const ra = parseInt(a.reviews,10)||0, rb = parseInt(b.reviews,10)||0;
    return rb - ra;
  });
}

function displayLeadsTable() {
  const section = document.getElementById("leadsSection");
  const host = document.getElementById("tableHost");
  if (!section || !host) return;

  chrome.storage.local.get("leads", (data) => {
    const leads = data.leads || [];
    section.style.display = "block";
    if (leads.length === 0) {
      host.innerHTML = `<div class="empty">No targets acquired. Run a sweep to populate.</div>`;
      return;
    }

    const table = document.createElement("table");
    table.innerHTML = `
      <thead><tr>
        <th>Business</th>
        <th>Signal</th>
        <th>Owner</th>
        <th>Rating</th>
        <th>Reviews</th>
        <th>Profile</th>
        <th>Website</th>
        <th>Phone</th>
        <th>Email</th>
      </tr></thead>
    `;

    const stats = computeMarketStats(leads);
    renderMarketRead(leads, stats);
    const tbody = document.createElement("tbody");
    const sorted = sortLeadsByBand(leads, stats);
    sorted.forEach((lead) => {
      const band = reviewBand(lead.reviews, stats);
      const row = document.createElement("tr");
      if (band === "thin" || band === "leader") row.classList.add("dim");
        if (band === "prime") row.classList.add("prime-row");
      row.innerHTML = `
        <td class="name">${lead.name}</td>
        <td>${blipHTML(band)}</td>
        <td class="mono">${lead.ownerName || "-"}</td>
        <td class="mono">${(lead.rating !== "" && lead.rating != null) ? lead.rating : "-"}</td>
        <td class="rev">${(lead.reviews !== "" && lead.reviews != null) ? lead.reviews : "-"}</td>
        <td><a href="${lead.profile}" target="_blank">View</a></td>
        <td style="word-break:break-word;max-width:200px;white-space:normal;"><a href="${lead.website}" target="_blank">${lead.website || "-"}</a></td>
        <td class="mono">${lead.phone || "-"}</td>
        <td class="mono">${lead.email || "-"}</td>
      `;
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    host.innerHTML = "";
    host.appendChild(table);


    // Bind action-button listeners once (buttons are static in the header now)
    if (!window.__prActionsBound) {
      window.__prActionsBound = true;

    document.getElementById("add-emails-btn")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "addEmails" });
    });


    document.getElementById("downloadCsvBtn")?.addEventListener("click", () => {
      chrome.storage.local.get("leads", ({ leads }) => {
        if (!leads || leads.length === 0) return;
        exportCSV(leads);
      });
    });

    document.getElementById("enrichMissingLeads").addEventListener("click", async () => {
      console.log("🔍 Enrich button pressed");
      cancelled = false;
      const store = await new Promise(res => chrome.storage.local.get("leads", res));
      const leads = store.leads || [];
      const isAclk = (u) => /google\.[a-z.]+\/aclk/i.test(u || "");
      const leadsToUpdate = leads.filter(lead => !lead.phone || !lead.website || isAclk(lead.website));

      console.log(`📊 Found ${leadsToUpdate.length} leads needing enrichment out of ${leads.length} total`);

      for (const lead of leadsToUpdate) {
        if(cancelled){
          console.warn("❌ Process cancelled");
          return;
        }

        console.log(`🔎 Processing: ${lead.name}`);

        await new Promise(resolve => {
          chrome.tabs.create({ url: lead.profile, active: false }, (tab) => {
            const tabId = tab.id;

            const cleanup = () => chrome.tabs.remove(tabId);

            // Set a timeout in case the script doesn't respond
            const timeoutId = setTimeout(() => {
              console.warn(`⏱️ Timeout for ${lead.name}`);
              chrome.runtime.onMessage.removeListener(listener);
              cleanup();
              resolve();
            }, 10000); // 10 second timeout

            chrome.scripting.executeScript({
              target: { tabId },
              files: ["profileScraper.js"]
            }, () => {
              // listen for data from the tab
              const listener = (msg, sender) => {
                if (msg.action === "profileDataExtracted" && sender.tab?.id === tabId) {
                  clearTimeout(timeoutId);

                  console.log(`✅ Data received for ${lead.name}:`, msg.data);

                  // ✅ FIX: Only update if new data exists, preserve existing data
                  if (msg.data.phone && msg.data.phone !== "null" && msg.data.phone !== "undefined") {
                    lead.phone = msg.data.phone;
                  }
                  if (msg.data.website && msg.data.website !== "null" && msg.data.website !== "undefined") {
                    // Replace if we had nothing, or if the current one is a Google ad-redirect
                    if (!lead.website || isAclk(lead.website)) {
                      lead.website = msg.data.website;
                    }
                  }

                  // ✅ Update the UI immediately with proper formatting
                  updateUI(lead);

                  const currentIndex = leadsToUpdate.indexOf(lead) + 1;
                  updateProgress(currentIndex, leadsToUpdate.length, "Scanning profiles");

                  chrome.runtime.onMessage.removeListener(listener);
                  cleanup();
                  resolve();
                }
              };

              chrome.runtime.onMessage.addListener(listener);
            });
          });
        });

        await new Promise(r => setTimeout(r, 1500)); // throttle - increased for reliability
      }

      console.log("💾 Saving updated leads:", leads.length);
      console.log("📋 Final leads data:", leads);

      saveLeads(leads);

      // ✅ Wait for save to complete before re-rendering
      setTimeout(() => {
        chrome.storage.local.get("leads", ({ leads }) => {
          displayLeadsTable();
          console.log("✅ Finished enriching and displaying all leads");
        });
      }, 500);
    });

    } // end __prActionsBound guard

  });
}


function exportCSV(leads) {
  function escapeCSV(value) {
    if (typeof value !== "string") value = value?.toString() ?? "";
    return `"${value.replace(/"/g, '""')}"`;
  }

  const header = "Name,Owner,Rating,Reviews,Website,Phone,Profile,Email";
  const rows = leads.map(l =>
    [
      escapeCSV(l.name),
      escapeCSV(l.ownerName),
      escapeCSV(l.rating),
      escapeCSV(l.reviews),
      escapeCSV(l.website),
      escapeCSV(l.phone),
      escapeCSV(l.profile),
      escapeCSV(l.email),
      escapeCSV(l.email)
    ].join(",")
  );

  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "leads.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url); // cleanup
}


chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "updateProgress") {
    updateProgress(request.current, request.total, request.label);
  }
});

document.getElementById("startOver").addEventListener("click", () => {
  // Clear storage
  chrome.storage.local.clear(() => {
    console.log("🔁 Storage cleared");
    updateProgress(100,100);
    console.log("resetsent")
    chrome.runtime.sendMessage({ action: "reset" });

    // Reset UI
    document.getElementById("leadsSection").style.display = "none";
    document.getElementById("progressContainer").style.display = "none";
    document.getElementById("progressBar").style.width = "0%";

    // Clear the table
    const table = document.querySelector("#leadsSection table tbody");
    if (table) table.innerHTML = "";

    // Reset search inputs and clear remembered search
    chrome.storage.local.remove("lastSearch");
    const nicheSel = document.getElementById("niche");
    if (nicheSel && nicheSel.options.length) nicheSel.selectedIndex = 0;
    updateNicheGuidance();
    document.getElementById("location").value = "";
    document.getElementById("cityWarn").style.display = "none";
    cancelled = true;

    // Show search UI again
    // If you have a wrapper div for the search area, you could re-show that too
  });
});







function updateUI(updatedLead) {
  console.log(`🎨 Updating UI for: ${updatedLead.name}`);

  const rows = document.querySelectorAll("table tr");
  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    // First cell is the name
    if (cells[0] && cells[0].textContent.trim() === updatedLead.name) {
      console.log(`✏️ Found row for ${updatedLead.name}, updating...`);

      // Column order: 0 Business | 1 Signal | 2 Owner | 3 Rating | 4 Reviews | 5 Profile | 6 Website | 7 Phone | 8 Email
      if (updatedLead.ownerName && cells[2]) {
        cells[2].textContent = updatedLead.ownerName;
      }
      if (cells[6]) {
        if (updatedLead.website && updatedLead.website !== "-") {
          cells[6].innerHTML = `<a href="${updatedLead.website}" target="_blank" style="word-break:break-word;">${updatedLead.website}</a>`;
        } else {
          cells[6].textContent = "-";
        }
      }
      if (cells[7]) {
        cells[7].textContent = updatedLead.phone || "-";
      }

      console.log(`✅ Updated row: Website=${updatedLead.website}, Phone=${updatedLead.phone}`);
    }
  });
}


function saveLeads(leads) {
  chrome.storage.local.set({ leads }, () => {
    console.log("💾 Updated leads saved to storage:", leads.length, "leads");
  });
}
