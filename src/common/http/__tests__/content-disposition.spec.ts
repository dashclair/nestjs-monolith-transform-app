import { attachmentDisposition } from '../content-disposition';

describe('attachmentDisposition', () => {
  it('keeps an ASCII name as is in both parameters', () => {
    expect(attachmentDisposition('report.json')).toBe(
      `attachment; filename="report.json"; filename*=UTF-8''report.json`,
    );
  });

  it('replaces non-ASCII in filename and UTF-8 encodes it in filename*', () => {
    expect(attachmentDisposition('отчёт.csv')).toBe(
      `attachment; filename="_____.csv"; filename*=UTF-8''${encodeURIComponent('отчёт.csv')}`,
    );
  });

  it('cannot break out of the quoted filename', () => {
    const header = attachmentDisposition('a"b\\c.csv');

    expect(header).toContain('filename="a_b_c.csv"');
    expect(header).toContain(`filename*=UTF-8''a%22b%5Cc.csv`);
  });

  it("percent-encodes ' ( ) * that encodeURIComponent leaves as is", () => {
    expect(attachmentDisposition("it's (1)*.csv")).toContain(
      `filename*=UTF-8''it%27s%20%281%29%2A.csv`,
    );
  });
});
