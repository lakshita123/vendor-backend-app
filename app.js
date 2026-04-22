// ===== CONFIG =====
const API_URL = window.CONFIG.API_BASE_URL + "/submit";

// ===== AUTO RETRY =====
window.addEventListener("load", async () => {
  const pending = localStorage.getItem("pendingForm");

  if (pending) {
    try {
      const data = JSON.parse(pending);
      const formData = new FormData();

      for (let key in data) {
        formData.append(key, data[key]);
      }

      await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      localStorage.removeItem("pendingForm");
      console.log("Recovered submission sent ✔");

    } catch (err) {
      console.log("Retry failed");
    }
  }
});

// ===== MAIN SUBMIT =====
document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("form");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(form);

    // ✅ Save TEXT data only
    const backup = {};
    formData.forEach((value, key) => {
      if (typeof value === "string") {
        backup[key] = value;
      }
    });

    localStorage.setItem("pendingForm", JSON.stringify(backup));

    showLoading();

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (data.success) {
        localStorage.removeItem("pendingForm");
        showSuccess();
      } else {
        throw new Error("Fail");
      }

    } catch (err) {
      // fallback
      navigator.sendBeacon(API_URL, formData);
      showMessage("Submitting in background...");
    }
  });
});

// ===== UI =====
function showLoading() {
  document.body.innerHTML = `
    <div style="text-align:center;padding:60px;">
      <h2>Submitting...</h2>
      <p>Do not close this page ⏳</p>
    </div>
  `;
}

function showSuccess() {
  document.body.innerHTML = `
    <div style="text-align:center;padding:60px;">
      <h2>✅ Submitted Successfully</h2>
    </div>
  `;
}

function showMessage(msg) {
  document.body.innerHTML = `
    <div style="text-align:center;padding:60px;">
      <h2>${msg}</h2>
    </div>
  `;
}
