import storageConfig from './storage.config';

describe('storageConfig', () => {
  it('separates the Docker endpoint from the browser endpoint', () => {
    const config = storageConfig();

    expect(config.endpoint).toBe('http://minio:9000');
    expect(config.publicEndpoint).toBe('http://localhost:9002');
    expect(config.bucket).toBe('streamtube-videos');
    expect(config.signedUrlExpiresIn).toBe(900);
  });
});
