/* ArcGIS OAuth 2.0 sign-in gate — same setup as the county profile site.
   - Full-page redirect to ArcGIS when the page is opened directly.
   - Pop-up sign-in (via oauth-callback.html) when the page is embedded in an iframe,
     such as the Experience Builder Embed widget.
   The dashboard's data only loads after sign-in (dash.start()). */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ CONFIG */
  const CONFIG = {
    CLIENT_ID: "SOme9Mv9P4kEIzH9",
    PORTAL_URL: "https://www.arcgis.com"   // change to https://<your-org>.maps.arcgis.com or your Enterprise portal if needed
  };

  const $ = (id) => document.getElementById(id);
  const btnSignIn = $("btnSignIn");
  const gateMsg = (m) => ($("gateMsg").textContent = m || "");
  let esriIdRef = null;

  // Local preview without sign-in: only on localhost and only with ?preview
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname) &&
                         new URLSearchParams(location.search).has("preview");

  function showApp(userLabel) {
    $("gate").hidden = true;
    $("gate").style.display = "none";
    $("app").hidden = false;
    $("userName").textContent = userLabel;
    window.dash.start();   // load the data and draw (charts size to the now-visible page)
  }

  function startAuth() {
    if (isLocalPreview) return showApp("Local preview (no sign-in)");
    if (typeof window.require !== "function") {
      btnSignIn.textContent = "Sign-in unavailable";
      gateMsg("Could not load the ArcGIS Maps SDK. Check your network connection and reload.");
      return;
    }
    window.require(["esri/identity/OAuthInfo", "esri/identity/IdentityManager", "esri/portal/Portal"],
      (OAuthInfo, esriId, Portal) => {
        esriIdRef = esriId;
        // Inside an iframe (e.g. Experience Builder Embed widget) the ArcGIS sign-in page
        // can't be shown in the frame, so sign in through a pop-up window instead.
        let inIframe = false;
        try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }
        const info = new OAuthInfo({
          appId: CONFIG.CLIENT_ID,
          portalUrl: CONFIG.PORTAL_URL,
          popup: inIframe,                                           // pop-up when embedded, full-page redirect otherwise
          popupCallbackUrl: new URL("oauth-callback.html", window.location.href).href,
          flowType: "auto"                                           // authorization code + PKCE
        });
        esriId.registerOAuthInfos([info]);
        const sharingUrl = info.portalUrl + "/sharing";

        const onSignedIn = () => {
          const portal = new Portal({ url: CONFIG.PORTAL_URL, authMode: "immediate" });
          return portal.load()
            .then(() => showApp(portal.user ? (portal.user.fullName || portal.user.username) : "Signed in"))
            .catch(() => showApp("Signed in"));
        };
        const resetButton = () => {
          btnSignIn.disabled = false;
          btnSignIn.textContent = "Sign in with ArcGIS";
        };
        // Backup when embedded: open the whole dashboard in a new browser tab
        const showNewTabOption = () => {
          if (!inIframe || $("newTabLink")) return;
          const p = document.createElement("p");
          p.style.fontSize = "13px";
          p.append("Pop-up didn't open? ");
          const a = document.createElement("a");
          a.id = "newTabLink"; a.href = window.location.href.split("#")[0]; a.target = "_blank"; a.rel = "noopener";
          a.textContent = "Open the dashboard in a new tab";
          p.append(a);
          $("gateMsg").after(p);
        };

        btnSignIn.onclick = () => {
          gateMsg("");
          btnSignIn.disabled = true;
          btnSignIn.textContent = inIframe ? "Complete sign-in in the pop-up…" : "Redirecting to ArcGIS…";
          // If nothing happens (pop-up blocked, window closed), let the user try again
          const stuck = setTimeout(() => {
            resetButton();
            if (inIframe) { gateMsg("Still waiting on the ArcGIS sign-in window. If it was blocked, allow pop-ups and try again."); showNewTabOption(); }
          }, 20000);
          esriId.getCredential(sharingUrl)
            .then(() => { clearTimeout(stuck); return onSignedIn(); })
            .catch((e) => {
              clearTimeout(stuck);
              console.warn("ArcGIS sign-in error", e);
              resetButton();
              gateMsg(e && e.message ? e.message : "Sign-in was cancelled.");
              showNewTabOption();
            });
        };

        esriId.checkSignInStatus(sharingUrl)
          .then(onSignedIn)
          .catch(resetButton);
      },
      (err) => gateMsg("ArcGIS SDK failed to load: " + (err && err.message)));
  }

  $("btnSignOut").onclick = () => {
    if (esriIdRef) esriIdRef.destroyCredentials();
    window.location.href = window.location.pathname;   // drop any hash / query
  };

  startAuth();
})();
