const serverInput = document.getElementById('server-input');
const addServerButton = document.getElementById('add-server');
const serverList = document.getElementById('server-list');
const statusIcon = document.getElementById('status-icon');
const statusText = document.getElementById('status-text');
const websiteCertValue = document.getElementById('website-cert-value');
const serverCertsContainer = document.getElementById('server-certs-container');

const STATUS_UNKNOWN = "unknown";
const STATUS_MATCH = "match";
const STATUS_MISMATCH = "mismatch";

function init() {
  loadServers();
  
  addServerButton.addEventListener('click', handleAddServer);
  
  updateCertificateDisplay();
}

function loadServers() {
  browser.runtime.sendMessage({ action: "getServers" })
    .then(response => {
      displayServers(response.servers || []);
    })
    .catch(error => {
    });
}

function displayServers(servers) {
  serverList.innerHTML = '';
  
  if (servers.length === 0) {
    const emptyMessage = document.createElement('li');
    emptyMessage.textContent = 'No verification servers added yet';
    emptyMessage.style.padding = '8px 0';
    emptyMessage.style.color = '#6c757d';
    emptyMessage.style.fontStyle = 'italic';
    serverList.appendChild(emptyMessage);
    return;
  }
  
  servers.forEach(server => {
    const listItem = document.createElement('li');
    listItem.className = 'server-item';
    
    const serverUrl = document.createElement('div');
    serverUrl.className = 'server-url';
    serverUrl.textContent = server;
    
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-button';
    deleteButton.textContent = 'Delete';
    deleteButton.dataset.server = server;
    deleteButton.addEventListener('click', handleDeleteServer);
    
    listItem.appendChild(serverUrl);
    listItem.appendChild(deleteButton);
    serverList.appendChild(listItem);
  });
}

function handleAddServer() {
  const serverUrl = serverInput.value.trim();
  
  if (!serverUrl) {
    alert('Please enter a valid server URL');
    return;
  }
  
  try {
    new URL(serverUrl);
  } catch (e) {
    alert('Please enter a valid URL including http:// or https://');
    return;
  }
  
  browser.runtime.sendMessage({ 
    action: "addServer", 
    serverUrl: serverUrl 
  })
  .then(response => {
    if (response && response.success) {
      serverInput.value = '';
      loadServers();
    } else {
      alert('Server already exists in the list');
    }
  })
  .catch(error => {
    alert('Failed to add server: ' + error.message);
  });
}

function handleDeleteServer(event) {
  const serverUrl = event.target.dataset.server;
  
  browser.runtime.sendMessage({ 
    action: "removeServer", 
    serverUrl: serverUrl 
  })
  .then(response => {
    if (response && response.success) {
      loadServers();
    } else {
      alert('Failed to remove server');
    }
  })
  .catch(error => {
    alert('Failed to remove server');
  });
}

function updateCertificateDisplay() {
  browser.tabs.query({ active: true, currentWindow: true })
    .then(tabs => {
      if (tabs[0]) {
        const currentTab = tabs[0];
        
        browser.runtime.sendMessage({ action: "getCertData" })
          .then(response => {
            const certData = response.certData;
            
            if (!certData.tabId || certData.tabId === currentTab.id) {
              displayCertificateData(certData);
            } else {
              displayCertificateData({ status: STATUS_UNKNOWN });
            }
          })
          .catch(error => {
            displayCertificateData({ status: STATUS_UNKNOWN });
          });
      }
    })
    .catch(error => {
      displayCertificateData({ status: STATUS_UNKNOWN });
    });
}

function displayCertificateData(certData) {
  updateStatusDisplay(certData.status);

  if (certData.websiteCert) {
    const cert = certData.websiteCert;
    
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'cert-summary';
    
    if (cert.fingerprint) {
      const fingerprintDiv = document.createElement('div');
      fingerprintDiv.className = 'cert-fingerprint';
      fingerprintDiv.innerHTML = `<strong>Fingerprint:</strong> ${formatFingerprint(cert.fingerprint)}`;
      summaryDiv.appendChild(fingerprintDiv);
    }
    
    if (cert.subject) {
      const subjectDiv = document.createElement('div');
      subjectDiv.innerHTML = `<strong>Subject:</strong> ${cert.subject}`;
      summaryDiv.appendChild(subjectDiv);
    }
    
    if (cert.issuer) {
      const issuerDiv = document.createElement('div');
      issuerDiv.innerHTML = `<strong>Issuer:</strong> ${cert.issuer}`;
      summaryDiv.appendChild(issuerDiv);
    }
    
    if (cert.validFrom && cert.validTo) {
      const validityDiv = document.createElement('div');
      validityDiv.innerHTML = `<strong>Valid:</strong> ${new Date(cert.validFrom).toLocaleDateString()} to ${new Date(cert.validTo).toLocaleDateString()}`;
      summaryDiv.appendChild(validityDiv);
    }
    
    websiteCertValue.textContent = JSON.stringify(cert, null, 2);
    websiteCertValue.parentNode.insertBefore(summaryDiv, websiteCertValue);
  } else {
    websiteCertValue.textContent = 'No certificate data available';
    websiteCertValue.style.fontStyle = 'italic';
    websiteCertValue.style.color = '#6c757d';
  }

  serverCertsContainer.innerHTML = '';

  if (certData.serverCerts && Object.keys(certData.serverCerts).length > 0) {
    Object.entries(certData.serverCerts).forEach(([serverUrl, data]) => {
      const serverCertSection = document.createElement('div');
      serverCertSection.className = 'cert-section';

      const header = document.createElement('div');
      header.className = 'cert-header';

      const serverName = document.createElement('h3');
      serverName.textContent = new URL(serverUrl).hostname;
      serverName.style.margin = '0';
      header.appendChild(serverName);

      if (!data.error && data.certificate) {
        const statusBadge = document.createElement('span');
        
        let isMatch = false;
        const serverFingerprint = data.certificate;
        
        if (certData.websiteCert && certData.websiteCert.fingerprint) {
          const normalizedWebFingerprint = certData.websiteCert.fingerprint.replace(/:/g, '').toLowerCase();
          let normalizedServerFingerprint;
          
          if (typeof serverFingerprint === 'string') {
            normalizedServerFingerprint = serverFingerprint.replace(/:/g, '').toLowerCase();
          } else if (serverFingerprint && typeof serverFingerprint === 'object' && serverFingerprint.fingerprint) {
            normalizedServerFingerprint = serverFingerprint.fingerprint.replace(/:/g, '').toLowerCase();
          }
          
          isMatch = normalizedWebFingerprint === normalizedServerFingerprint;
        }
        
        statusBadge.className = `cert-status ${isMatch ? 'cert-status-match' : 'cert-status-mismatch'}`;
        statusBadge.textContent = isMatch ? 'Match' : 'Mismatch';
        header.appendChild(statusBadge);
      } else if (data.error) {
        const errorBadge = document.createElement('span');
        errorBadge.className = 'cert-status cert-status-error';
        errorBadge.textContent = 'Error';
        header.appendChild(errorBadge);
      }

      serverCertSection.appendChild(header);

      if (data.certificate) {
        const certValue = document.createElement('div');
        certValue.className = 'cert-value';
        
        if (typeof data.certificate === 'string') {
          certValue.innerHTML = `<strong>Fingerprint:</strong> ${formatFingerprint(data.certificate)}`;
        } else if (typeof data.certificate === 'object') {
          if (data.certificate.fingerprint) {
            certValue.innerHTML = `<strong>Fingerprint:</strong> ${formatFingerprint(data.certificate.fingerprint)}`;
          } else {
            certValue.textContent = JSON.stringify(data.certificate, null, 2);
          }
        } else {
          certValue.textContent = String(data.certificate);
        }
        
        serverCertSection.appendChild(certValue);
      } else if (data.error) {
        const errorText = document.createElement('div');
        errorText.className = 'cert-error';
        errorText.textContent = data.error;
        serverCertSection.appendChild(errorText);
      } else {
        const noCertText = document.createElement('div');
        noCertText.className = 'cert-value';
        noCertText.textContent = 'No certificate data available';
        noCertText.style.fontStyle = 'italic';
        noCertText.style.color = '#6c757d';
        serverCertSection.appendChild(noCertText);
      }

      serverCertsContainer.appendChild(serverCertSection);
    });
  } else if (certData.status !== STATUS_UNKNOWN) {
    const noServersMsg = document.createElement('div');
    noServersMsg.textContent = 'No server certificate data available';
    noServersMsg.style.padding = '12px';
    noServersMsg.style.fontStyle = 'italic';
    noServersMsg.style.color = '#6c757d';
    noServersMsg.style.textAlign = 'center';
    serverCertsContainer.appendChild(noServersMsg);
  }
}

function formatFingerprint(fingerprint) {
  const cleanFingerprint = fingerprint.replace(/:/g, '');
  
  let formatted = '';
  for (let i = 0; i < cleanFingerprint.length; i += 2) {
    formatted += cleanFingerprint.substr(i, 2);
    if (i < cleanFingerprint.length - 2) {
      formatted += ':';
    }
  }
  
  return formatted;
}

function updateStatusDisplay(status) {
  switch(status) {
    case STATUS_MATCH:
      statusIcon.className = 'status-icon status-success';
      statusText.textContent = 'Certificate check passed';
      break;
    case STATUS_MISMATCH:
      statusIcon.className = 'status-icon status-failure';
      statusText.textContent = 'Certificate mismatch detected';
      break;
    case STATUS_UNKNOWN:
    default:
      statusIcon.className = 'status-icon status-default';
      statusText.textContent = 'Certificate not yet checked';
      break;
  }
}

document.addEventListener('DOMContentLoaded', init);
