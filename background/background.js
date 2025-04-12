let serverList = [];

const ICON_DEFAULT = "../icons/icon-default-48.png";
const ICON_SUCCESS = "../icons/icon-success-48.png";
const ICON_FAILURE = "../icons/icon-failure-48.png";

const STATUS_UNKNOWN = "unknown";
const STATUS_MATCH = "match";
const STATUS_MISMATCH = "mismatch";

let pendingCertRequests = {};

function init() {
  browser.storage.local.get('servers').then(result => {
    if (result.servers) {
      serverList = result.servers;
    }
  });

  browser.webRequest.onCompleted.addListener(
    checkCertificate,
    { urls: ["<all_urls>"], types: ["main_frame"] }
  );
  
  browser.webRequest.onHeadersReceived.addListener(
    storeSecurityInfo,
    { urls: ["<all_urls>"] },
    ["blocking"]
  );
}

function storeSecurityInfo(details) {
  if (details.type !== "main_frame") {
    return;
  }
  
  try {
    browser.webRequest.getSecurityInfo(
      details.requestId,
      { certificateChain: true }
    ).then(securityInfo => {
      if (securityInfo.state === "secure" || securityInfo.state === "weak") {
        pendingCertRequests[details.url] = {
          certificate: processCertificate(securityInfo.certificates[0]),
          timestamp: Date.now()
        };
      }
    })
    .catch(error => {
    });
  } catch (error) {
  }
  
  return {};
}

function processCertificate(cert) {
  return {
    fingerprint: cert.fingerprint.sha256,
    subject: cert.subject,
    issuer: cert.issuer,
    serialNumber: cert.serialNumber,
    isEV: cert.isExtendedValidation,
    validFrom: cert.validity.start,
    validTo: cert.validity.end
  };
}

function saveServers() {
  browser.storage.local.set({ servers: serverList });
}

function saveCertData(tabId, status, websiteCert, serverCerts) {
  browser.storage.local.set({ 
    certData: { 
      tabId: tabId, 
      status: status,
      timestamp: Date.now(),
      websiteCert: websiteCert,
      serverCerts: serverCerts
    } 
  });
}

function addServer(server) {
  if (!serverList.includes(server)) {
    serverList.push(server);
    saveServers();
    return true;
  }
  return false;
}

function removeServer(server) {
  const index = serverList.indexOf(server);
  if (index > -1) {
    serverList.splice(index, 1);
    saveServers();
    return true;
  }
  return false;
}

function getWebsiteCertificate(url) {
  return new Promise((resolve, reject) => {
    if (pendingCertRequests[url] && 
        pendingCertRequests[url].timestamp > Date.now() - 60000) {
      resolve(pendingCertRequests[url].certificate);
      return;
    }
    
    fetch(url, { 
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow'
    })
    .then(() => {
      if (pendingCertRequests[url]) {
        resolve(pendingCertRequests[url].certificate);
      } else {
        reject(new Error("Could not retrieve certificate"));
      }
    })
    .catch(error => {
      reject(error);
    });
  });
}

function getServerCertificate(serverUrl, websiteUrl) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", serverUrl, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            
            const fingerprint = response.fingerprint;
            
            if (!fingerprint) {
              reject("No fingerprint in server response");
              return;
            }
            
            resolve(fingerprint);
          } catch (e) {
            reject("Invalid response from server");
          }
        } else {
          reject(`Server responded with status ${xhr.status}`);
        }
      }
    };
    
    xhr.onerror = function() {
      reject("Error communicating with verification server");
    };
    
    const payload = JSON.stringify({ url: websiteUrl });
    xhr.send(payload);
  });
}

async function checkCertificate(details) {
  browser.browserAction.setIcon({ path: ICON_DEFAULT });
  
  if (serverList.length === 0) {
    saveCertData(details.tabId, STATUS_UNKNOWN, null, {});
    return;
  }
  
  const websiteUrl = details.url;
  const tabId = details.tabId;
  
  try {
    const websiteCertificate = await getWebsiteCertificate(websiteUrl);
    
    const serverCerts = {};
    
    const results = [];
    
    for (const serverUrl of serverList) {
      try {
        const serverCertificate = await getServerCertificate(serverUrl, websiteUrl);
        
        serverCerts[serverUrl] = {
          certificate: serverCertificate,
          error: null
        };
        
        const isMatch = compareCertificates(websiteCertificate, serverCertificate);
        results.push(isMatch);
      } catch (error) {
        serverCerts[serverUrl] = {
          certificate: null,
          error: error.toString()
        };
        
        results.push(false);
      }
    }
    
    if (results.length > 0) {
      const allMatch = results.every(result => result === true);
      
      saveCertData(
        tabId, 
        allMatch ? STATUS_MATCH : STATUS_MISMATCH,
        websiteCertificate,
        serverCerts
      );
      
      browser.browserAction.setIcon({
        path: allMatch ? ICON_SUCCESS : ICON_FAILURE,
        tabId: tabId
      });
    }
  } catch (error) {
    saveCertData(details.tabId, STATUS_UNKNOWN, null, {});
  }
}

function compareCertificates(cert1, cert2) {
  const websiteFingerprint = cert1.fingerprint;
  
  const serverFingerprint = cert2;
  
  const normalizedWebFingerprint = websiteFingerprint.replace(/:/g, '').toLowerCase();
  
  let normalizedServerFingerprint;
  
  if (typeof serverFingerprint === 'string') {
    normalizedServerFingerprint = serverFingerprint.replace(/:/g, '').toLowerCase();
  } else if (serverFingerprint && typeof serverFingerprint === 'object' && serverFingerprint.fingerprint) {
    normalizedServerFingerprint = serverFingerprint.fingerprint.replace(/:/g, '').toLowerCase();
  } else {
    return false;
  }
  
  return normalizedWebFingerprint === normalizedServerFingerprint;
}

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getServers") {
    return Promise.resolve({ servers: serverList });
  } 
  else if (message.action === "addServer") {
    const result = addServer(message.serverUrl);
    return Promise.resolve({ success: result });
  } 
  else if (message.action === "removeServer") {
    const result = removeServer(message.serverUrl);
    return Promise.resolve({ success: result });
  }
  else if (message.action === "getCertData") {
    return browser.storage.local.get('certData').then(result => {
      return { certData: result.certData || { status: STATUS_UNKNOWN } };
    });
  }

  return false;
});

init();
