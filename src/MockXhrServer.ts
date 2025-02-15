import MockXhr from './MockXhr';
import { normalizeHTTPMethodName } from './Utils';

import type MockXhrRequest from './MockXhrRequest';

export type UrlMatcher = ((url: string) => boolean) | string | RegExp;

export interface RequestHandlerResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

type RequestHandlerCallback = (request: MockXhrRequest) => void;

type SingleRequestHandler =
  Partial<RequestHandlerResponse>
  | RequestHandlerCallback
  | 'error'
  | 'timeout';

export type RequestHandler = SingleRequestHandler | SingleRequestHandler[];

interface Route {
  urlMatcher: UrlMatcher,
  handler: RequestHandler,
  count: number,
}

interface RequestLogEntry {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any
}

/**
 * Mock server for responding to XMLHttpRequest mocks from the class MockXhr. Provides simple route
 * matching and request handlers to make test harness creation easier.
 */
export default class MockXhrServer {
  private _MockXhr: typeof MockXhr;

  private _requests: RequestLogEntry[];

  private _routes: Record<string, Route[]>;

  private _xhrFactory: () => MockXhr;

  private _savedContext?: any;

  private _savedContextHadXMLHttpRequest?: boolean;

  private _savedXMLHttpRequest?: any;

  private _defaultRoute?: { handler: RequestHandler; count: number; };

  /**
   * Constructor
   *
   * @param xhrMock XMLHttpRequest mock class
   * @param routes Routes
   */
  constructor(xhrMock: typeof MockXhr, routes?: Record<string, [UrlMatcher, RequestHandler]>) {
    this._MockXhr = xhrMock;
    this._requests = [];
    this._routes = {};
    if (routes) {
      Object.entries(routes).forEach(([method, [urlMatcher, handler]]) => {
        this.addHandler(method, urlMatcher, handler);
      });
    }
    xhrMock.onSend = (request) => { this._handleRequest(request); };

    // Setup a mock request factory for users
    this._xhrFactory = () => new this._MockXhr();
  }

  public get MockXhr() {
    return this._MockXhr;
  }

  /**
   * For backwards compatibility with versions < 4.1.0
   *
   * @deprecated Use the MockXhr property instead
   */
  public get xhrMock() {
    return this._MockXhr;
  }

  public get xhrFactory() {
    return this._xhrFactory;
  }

  /**
   * Install the server's XMLHttpRequest mock in the global context. You can specify a different
   * context with the optional `context` argument. Revert with remove().
   *
   * @param context Context object (e.g. global, window)
   * @returns this
   */
  install(context: any = globalThis) {
    this._savedContext = context;

    // Distinguish between an undefined and a missing XMLHttpRequest property
    if ('XMLHttpRequest' in context) {
      this._savedContextHadXMLHttpRequest = true;
      this._savedXMLHttpRequest = context.XMLHttpRequest;
    } else {
      this._savedContextHadXMLHttpRequest = false;
    }
    context.XMLHttpRequest = this._MockXhr;
    return this;
  }

  /**
   * Revert the changes made by install(). Call this after your tests.
   */
  remove() {
    if (!this._savedContext) {
      throw new Error('remove() called without a matching install(context).');
    }

    if (this._savedContextHadXMLHttpRequest) {
      this._savedContext.XMLHttpRequest = this._savedXMLHttpRequest;
      delete this._savedXMLHttpRequest;
    } else {
      delete this._savedContext.XMLHttpRequest;
    }
    delete this._savedContext;
  }

  /**
   * Disable the effects of the timeout attribute on the XMLHttpRequest mock used by the server.
   */
  disableTimeout() {
    this._MockXhr.timeoutEnabled = false;
  }

  /**
   * Enable the effects of the timeout attribute on the XMLHttpRequest mock used by the server.
   */
  enableTimeout() {
    this._MockXhr.timeoutEnabled = true;
  }

  /**
   * Add a GET request handler.
   *
   * @param urlMatcher Url matcher
   * @param handler Request handler
   * @returns this
   */
  get(urlMatcher: UrlMatcher, handler: RequestHandler) {
    return this.addHandler('GET', urlMatcher, handler);
  }

  /**
   * Add a POST request handler.
   *
   * @param urlMatcher Url matcher
   * @param handler Request handler
   * @returns this
   */
  post(urlMatcher: UrlMatcher, handler: RequestHandler) {
    return this.addHandler('POST', urlMatcher, handler);
  }

  /**
   * Add a PUT request handler.
   *
   * @param urlMatcher Url matcher
   * @param handler Request handler
   * @returns this
   */
  put(urlMatcher: UrlMatcher, handler: RequestHandler) {
    return this.addHandler('PUT', urlMatcher, handler);
  }

  /**
   * Add a DELETE request handler.
   *
   * @param urlMatcher Url matcher
   * @param handler Request handler
   * @returns this
   */
  delete(urlMatcher: UrlMatcher, handler: RequestHandler) {
    return this.addHandler('DELETE', urlMatcher, handler);
  }

  /**
   * Add a request handler.
   *
   * @param method HTTP method
   * @param urlMatcher Url matcher
   * @param handler Request handler
   * @returns this
   */
  addHandler(method: string, urlMatcher: UrlMatcher, handler: RequestHandler) {
    // Match the processing done in MockXHR for the method name
    method = normalizeHTTPMethodName(method);
    const routes = this._routes[method] ?? (this._routes[method] = []);
    routes.push({ urlMatcher, handler, count: 0 });
    return this;
  }

  /**
   * Set the default request handler for requests that don't match any route.
   *
   * @param handler Request handler
   * @returns this
   */
  setDefaultHandler(handler: RequestHandler) {
    this._defaultRoute = { handler, count: 0 };
    return this;
  }

  /**
   * Return 404 responses for requests that don't match any route.
   *
   * @returns this
   */
  setDefault404() {
    return this.setDefaultHandler({ status: 404 });
  }

  /**
   * @returns Array of requests received by the server. Entries: { method, url, headers, body? }
   */
  getRequestLog(): readonly RequestLogEntry[] {
    return [...this._requests];
  }

  private _handleRequest(request: MockXhrRequest) {
    // Record the request for easier debugging
    this._requests.push({
      method: request.method,
      url: request.url,
      headers: request.requestHeaders.getHash(),
      body: request.body,
    });

    const route = this._findFirstMatchingRoute(request) ?? this._defaultRoute;
    if (route) {
      // Routes can have arrays of handlers. Each one is used once and the last one is used if out
      // of elements.
      let { handler } = route;
      if (Array.isArray(handler)) {
        handler = handler[Math.min(handler.length - 1, route.count)];
      }
      route.count += 1;

      if (typeof handler === 'function') {
        handler(request);
      } else if (handler === 'error') {
        request.setNetworkError();
      } else if (handler === 'timeout') {
        request.setRequestTimeout();
      } else {
        request.respond(handler.status, handler.headers, handler.body, handler.statusText);
      }
    }
  }

  private _findFirstMatchingRoute(request: MockXhrRequest) {
    const method = normalizeHTTPMethodName(request.method);
    if (!this._routes[method]) {
      return undefined;
    }

    const { url } = request;
    return this._routes[method].find((route) => {
      const { urlMatcher } = route;
      if (typeof urlMatcher === 'function') {
        return urlMatcher(url);
      } else if (urlMatcher instanceof RegExp) {
        return urlMatcher.test(url);
      }
      return urlMatcher === url;
    });
  }
}
