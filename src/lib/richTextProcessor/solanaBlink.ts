import {
  ActionRequestURLFields,
  BlinkURLFields,
  parseURL,
  type ActionGetResponse,
  type ActionPostRequest,
  type ActionPostResponse,
  type ActionsJson
} from '@solana/actions';

export interface ReferenceProperty {
  type: string;
  required?: boolean;
  isArray?: boolean;
  children?: ReferenceProperty | ReferenceObject;
}

export type ReferenceObject = {
  [key: string]: ReferenceProperty | ReferenceObject;
};

export const STRUCT_ACTIONS_JSON: ReferenceObject = {
  rules: {
    // todo
    type: 'array',
    required: true
  }
};

export const STRUCT_ACTIONS_GET_RESPONSE: ReferenceObject = {
  title: {
    type: 'string',
    required: true
  },
  icon: {
    type: 'string',
    required: true
  },
  label: {
    type: 'string',
    required: true
  },
  description: {
    type: 'string',
    required: true
  },
  disabled: {
    type: 'boolean',
    required: false
  },
  error: {
    type: 'object',
    required: false
  },
  links: {
    type: 'object',
    required: false,
    children: {
      actions: {
        // todo:
        type: 'array',
        required: true
      }
    }
  }
};

export const STRUCT_ACTIONS_POST_RESPONSE: ReferenceObject = {
  transaction: {
    type: 'string',
    required: true
  },
  message: {
    type: 'string',
    required: false
  }
};

export class StructureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructureValidationError';
  }
}

export function validateStructure(
  reference: ReferenceObject,
  target: any
): any {
  if(typeof target === 'string') {
    try {
      target = JSON.parse(target);
    } catch(error) {
      throw new StructureValidationError('Target is not valid JSON');
    }
  }

  if(typeof target == 'string') {
    throw new StructureValidationError('Target is not valid JSON');
  }

  if(Array.isArray(reference)) {
    if(!Array.isArray(target)) {
      throw new StructureValidationError('Target must be an array');
    }

    if(reference.length !== 1) {
      throw new StructureValidationError(
        'Array reference must have exactly one element'
      );
    }

    const referenceItem = reference[0];
    const validatedArray = [];

    for(const item of target) {
      validatedArray.push(validateStructure(referenceItem, item));
    }

    return validatedArray;
  }

  if(
    typeof reference !== 'object' ||
    (reference === null &&
      (reference as unknown as ReferenceProperty)?.required == true)
  ) {
    console.log('target:', target);
    console.log('reference:', reference);
    throw new StructureValidationError(
      'Reference must be a non-null object or array'
    );
  }

  if(typeof target !== 'object' || target === null) {
    throw new StructureValidationError(
      'Target must be a non-null object or array'
    );
  }

  for(const key in reference) {
    const referenceProperty = reference[key] as ReferenceProperty;

    if(!target.hasOwnProperty(key)) {
      if(referenceProperty.required) {
        throw new StructureValidationError(
          `Missing key '${key}' in target object`
        );
      }
      console.log('key:', key);

      continue;
      // Skip optional properties if they are missing
    }

    // Skip optional properties if their value is nullish
    if(!referenceProperty.required && !target[key]) continue;

    const referenceType = referenceProperty.type;
    const targetType = Array.isArray(target[key]) ?
      'array' :
      typeof target[key];

    if(referenceType === 'object') {
      if(
        Array.isArray(referenceProperty.children) &&
        Array.isArray(target[key])
      ) {
        continue; // Assume arrays are correctly structured, additional checks can be added if necessary
      } else if(
        !validateStructure(
          referenceProperty.children as ReferenceObject,
          target[key]
        )
      ) {
        throw new StructureValidationError(
          `Structure mismatch at key '${key}'`
        );
      }
    } else if(referenceType !== targetType) {
      throw new StructureValidationError(
        `Type mismatch at key '${key}'. Expected '${referenceType}', got '${targetType}'`
      );
    }
  }

  return target;
}

export async function fetchActionsJson(url: URL) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    redirect: 'manual'
  });
  if(res.ok) {
    const actionsString = await res.text();
    const actionsJson = validateStructure(
      STRUCT_ACTIONS_JSON,
      actionsString
    ) as ActionsJson;
    return actionsJson;
  }
  throw Error('Failed fetch Actions.json');
}

export async function fetchActionsGet(url: URL) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    redirect: 'manual'
  });

  if(res.ok) {
    const actionsGetString = await res.text();
    const actionsGetJson = validateStructure(
      STRUCT_ACTIONS_GET_RESPONSE,
      actionsGetString
    ) as ActionGetResponse;
    return actionsGetJson;
  }
  throw Error('Failed fetch Actions Get');
}

export async function isVerifiedAction(actionUrl: URL): Promise<boolean> {
  const res = await fetch('https://actions-registry.dialectapi.to/all');
  if(res.ok) {
    const result = await res.json();
    const actionList = result.actions as {host: string, state: string}[];
    console.log('actionUrl host: ', actionUrl.host)
    const verified = actionList.find(({host, state}) => host === actionUrl.host && state === 'trusted');
    return !!verified;
  }
  return false;
}

export async function fetchActionsPost(url: URL, body: ActionPostRequest) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if(res.ok) {
    const actionsPostString = await res.text();
    const actionsPostJson = validateStructure(
      STRUCT_ACTIONS_POST_RESPONSE,
      actionsPostString
    ) as ActionPostResponse;
    return actionsPostJson;
  }
  throw Error('Failed fetch Actions Get');
}

export class ActionsURLMapper {
  private config: ActionsJson;

  constructor(config: ActionsJson) {
    this.config = config;
  }

  public mapUrl(url: string | URL): string | null {
    // Ensure the input is a URL object
    const urlObj = typeof url === 'string' ? new URL(url) : url;
    const queryParams = urlObj.search; // Extract the query parameters from the URL

    for(const action of this.config.rules) {
      // Handle direct mapping without wildcards
      if(this.isExactMatch(action.pathPattern, urlObj)) {
        return `${action.apiPath}${queryParams}`;
      }

      // Match the pattern with the URL
      const match = this.matchPattern(action.pathPattern, urlObj);

      if(match) {
        // Construct the mapped URL if there's a match
        return this.constructMappedUrl(
          action.apiPath,
          match,
          queryParams,
          urlObj.origin
        );
      }
    }

    // If no match is found, return null
    return null;
  }

  // Helper method to check for exact match
  private isExactMatch(pattern: string, urlObj: URL): boolean {
    return pattern === `${urlObj.origin}${urlObj.pathname}`;
  }

  // Helper method to match the URL with the pattern
  private matchPattern(pattern: string, urlObj: URL): RegExpMatchArray | null {
    const fullPattern = new RegExp(
      `^${pattern.replace(/\*\*/g, '(.*)').replace(/\/(\*)/g, '/([^/]+)')}$`
    );

    const urlToMatch = pattern.startsWith('http') ?
      urlObj.toString() :
      urlObj.pathname;
    return urlToMatch.match(fullPattern);
  }

  // Helper method to construct the mapped URL
  private constructMappedUrl(
    apiPath: string,
    match: RegExpMatchArray,
    queryParams: string,
    origin: string
  ): string {
    let mappedPath = apiPath;
    match.slice(1).forEach((group) => {
      mappedPath = mappedPath.replace(/\*+/, group);
    });

    if(apiPath.startsWith('http')) {
      const mappedUrl = new URL(mappedPath);
      return `${mappedUrl.origin}${mappedUrl.pathname}${queryParams}`;
    }

    return `${origin}${mappedPath}${queryParams}`;
  }
}

export function linkedActionHref(href: string, getEndpointUrl: URL): string {
  return new URL(
    href,
    href.startsWith('/') ? getEndpointUrl.origin : undefined
  ).toString();
}

export async function detectSolanaAction(
  url: string
): Promise<{actionUrl: URL, actionsGet: ActionGetResponse, actionsJson: ActionsJson, verified: boolean} | undefined> {
  let actionUrl: URL;
  try {
    const parsedUrl = parseURL(url);
    if(!!(parsedUrl as BlinkURLFields)?.blink) {
      // is Blink
      actionUrl = (parsedUrl as BlinkURLFields).action.link;
    }
    if(!!(parsedUrl as ActionRequestURLFields)?.link) {
      // is Action
      actionUrl = (parsedUrl as ActionRequestURLFields).link;
    }
  } catch(e) {
    // detect origin url
    actionUrl = new URL(url);
  }
  try {
    const actionsJson = await fetchActionsJson(
      new URL('actions.json', actionUrl.origin)
    );
    console.log('actionsJson: ', actionsJson);
    const actionsURLMapper = new ActionsURLMapper(actionsJson);
    const mappedUrl = new URL(actionsURLMapper.mapUrl(actionUrl));
    const [actionsGet, verified] = await Promise.all([fetchActionsGet(mappedUrl), isVerifiedAction(mappedUrl)])
    return {actionUrl: mappedUrl, actionsJson, actionsGet, verified};
  } catch(e) {
    return;
  }
}

export const getProvider = () => {
  if('phantom' in window) {
    const provider = window.phantom?.solana;

    if(provider?.isPhantom) {
      return provider;
    }
  }

  window.open('https://phantom.app/', '_blank');
};
