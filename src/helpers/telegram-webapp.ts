function urlSafeDecode(urlencoded: string) {
  try {
    urlencoded = urlencoded.replace(/\+/g, '%20');
    return decodeURIComponent(urlencoded);
  } catch(e) {
    return urlencoded;
  }
}

export function urlParseHashParams(locationHash: string) {
  locationHash = locationHash.replace(/^#/, '');
  const params:Record<string, any> = {};
  if(!locationHash.length) {
    return params;
  }
  if(locationHash.indexOf('=') < 0 && locationHash.indexOf('?') < 0) {
    params._path = urlSafeDecode(locationHash);
    return params;
  }
  const qIndex = locationHash.indexOf('?');
  if(qIndex >= 0) {
    const pathParam = locationHash.substr(0, qIndex);
    params._path = urlSafeDecode(pathParam);
    locationHash = locationHash.substr(qIndex + 1);
  }
  const query_params = urlParseQueryString(locationHash);
  for(const k in query_params) {
    params[k] = query_params[k];
  }
  return params;
}

export function urlParseQueryString(queryString: string) {
  const params: Record<string, any> = {};
  if(!queryString.length) {
    return params;
  }
  const queryStringParams = queryString.split('&');
  let i, param, paramName, paramValue;
  for(i = 0; i < queryStringParams.length; i++) {
    param = queryStringParams[i].split('=');
    paramName = urlSafeDecode(param[0]);
    paramValue = param[1] == null ? null : urlSafeDecode(param[1]);
    params[paramName] = paramValue;
  }
  return params;
}
