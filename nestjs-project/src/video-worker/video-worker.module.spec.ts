import { Test, TestingModule } from '@nestjs/testing';
import { VideoProcessingConsumer } from './video-processing.consumer';
import { VideoWorkerModule } from './video-worker.module';

describe('VideoWorkerModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('compiles the independent queue consumer runtime', () => {
    expect(moduleRef.get(VideoProcessingConsumer)).toBeInstanceOf(
      VideoProcessingConsumer,
    );
  });
});
