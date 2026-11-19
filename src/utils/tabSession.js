// Bind requests to the account shown in this document. Only a login or logout
// initiated here may change it. A different tab's session gets a new document.
let tabToken;

export function getTabToken() {
    if (tabToken === undefined) tabToken = localStorage.getItem('authToken');
    return tabToken;
}

export function setTabToken(token) {
    tabToken = token;
}
