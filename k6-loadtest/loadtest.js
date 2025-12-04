import http from 'k6/http';
import { check } from 'k6';

// Load test configuration: ramps up from 10 to 30 virtual users over 5.5 minutes
export const options = {
  stages: [
    { duration: '30s', target: 10 },  // Ramp up to 10 users in 30 seconds
    { duration: '1m', target: 20 },    // Ramp up to 20 users in 1 minute
    { duration: '1m', target: 30 },    // Ramp up to 30 users in 1 minute
    { duration: '2m', target: 30 },    // Stay at 30 users for 2 minutes
    { duration: '1m', target: 0 },      // Ramp down to 0 users in 1 minute
  ],
};

export default function () {
  // Randomly choose between foo and bar (50/50 split) to generate randomized traffic
  const hosts = [
    { hostname: 'foo.localhost', expected: 'foo' },
    { hostname: 'bar.localhost', expected: 'bar' }
  ];
  const target = hosts[Math.floor(Math.random() * hosts.length)];
  
  // Set the Host header to tell the ingress controller which hostname we're requesting
  // This enables hostname-based routing (foo.localhost → foo service, bar.localhost → bar service)
  const params = {
    headers: {
      'Host': target.hostname,
    },
  };
  
  // Why we use the ingress controller service URL instead of the hostname directly:
  // - Inside Kubernetes, 'foo.localhost' and 'bar.localhost' don't resolve via DNS
  // - The ingress controller service (ingress-nginx-controller) is the actual entry point
  // - We hit the ingress controller service (which has a real IP) and use the Host header
  // - The ingress controller reads the Host header and routes to the correct backend service
  // This is how hostname-based routing works when testing from inside the cluster
  const response = http.get('http://ingress-nginx-controller.ingress-nginx.svc.cluster.local', params);
  
  // k6 automatically tracks these metrics for every http.get() call:
  // - http_req_duration (avg, p90, p95, p99, min, max, etc.)
  // - http_req_failed (failure rate)
  // - http_reqs (requests per second)
  // No special configuration needed - these are built-in metrics
  
  // Validate the response is correct.
  // hashicorp/http-echo appends a newline, so we trim whitespace before comparing.
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response is correct': (r) => r.body.trim() === target.expected,
  });
}
