// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { BLOCKED_V4, canonicalIp, classifyIp, formatIpv4, parseIpv4, parseIpv6 } from '../../src/net/ip.js';

describe('parseIpv4', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['2130706433', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['0x7f.0.0.1', '127.0.0.1'],
    ['0x7f.1', '127.0.0.1'],
    ['127.1', '127.0.0.1'],
    ['0x7f000001', '127.0.0.1'],
    ['017700000001', '127.0.0.1'],
    ['10.0.0.1.', '10.0.0.1'],
    ['0', '0.0.0.0'],
    ['0x', '0.0.0.0'],
    ['169.254.43518', '169.254.169.254'],
  ])('parses %s', (input, expected) => {
    const v = parseIpv4(input);
    expect(v).not.toBeNull();
    expect(formatIpv4(v ?? -1)).toBe(expected);
  });

  it.each(['256.0.0.1', '1.2.3.4.5', '1.2.3.256', '08.0.0.1', '0x1g.0.0.1', 'example.com', '', '1..2.3', '4294967296', '-1.2.3.4'])(
    'rejects %s',
    (input) => {
      expect(parseIpv4(input)).toBeNull();
    },
  );
});

describe('parseIpv6', () => {
  it('parses compressed, full and embedded forms', () => {
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('[::1]')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6('2001:db8:0:0:0:0:0:1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it.each([':::', '1::2::3', '12345::', '::ffff:1.2.3.256', '1:2:3:4:5:6:7:8:9', 'g::1', '1:2:3:4:5:6:7', 'abc'])('rejects %s', (input) => {
    expect(parseIpv6(input)).toBeNull();
  });
});

describe('classifyIp', () => {
  it.each([
    ['0.0.0.0', 'this-network'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.254', 'cgnat'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback'],
    ['169.254.1.1', 'link-local'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.8', 'ietf-protocol'],
    ['192.0.2.1', 'documentation'],
    ['192.88.99.1', '6to4-relay'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.1', 'documentation'],
    ['203.0.113.1', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['169.254.169.254', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['168.63.129.16', 'metadata'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['::ffff:8.8.8.8', 'ipv4-mapped'],
    ['::127.0.0.1', 'ipv4-compatible'],
    ['::ffff:0:7f00:1', 'ipv4-translated'],
    ['64:ff9b::7f00:1', 'nat64'],
    ['64:ff9b:1::1', 'nat64'],
    ['100::1', 'discard'],
    ['2001::1', 'ietf-protocol'],
    ['2001:db8::1', 'documentation'],
    ['2002:7f00:1::1', '6to4'],
    ['3fff::1', 'documentation'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['fd00:ec2::254', 'metadata'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'link-local'],
    ['fec0::1', 'site-local'],
    ['ff02::1', 'multicast'],
    ['4000::1', 'not-global-unicast'],
    ['not-an-ip', 'unparseable'],
  ])('blocks %s (%s)', (ip, reason) => {
    const v = classifyIp(ip);
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe(reason);
  });

  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '2a00:1450:4001::200e', '2606:4700::1111'])(
    'allows public %s',
    (ip) => {
      expect(classifyIp(ip).blocked).toBe(false);
    },
  );

  it('marks metadata addresses', () => {
    expect(classifyIp('169.254.169.254').metadata).toBe(true);
    expect(classifyIp('fd00:ec2::254').metadata).toBe(true);
    expect(classifyIp('10.0.0.1').metadata).toBe(false);
  });

  it('every listed IPv4 range blocks its base and last address', () => {
    for (const r of BLOCKED_V4) {
      const size = 2 ** (32 - r.bits);
      expect(classifyIp(formatIpv4(r.base)).blocked).toBe(true);
      expect(classifyIp(formatIpv4((r.base + size - 1) >>> 0)).blocked).toBe(true);
    }
  });
});

describe('canonicalIp', () => {
  it('normalises forms', () => {
    expect(canonicalIp('0177.0.0.1')).toBe('127.0.0.1');
    expect(canonicalIp('::1')).toBe('0:0:0:0:0:0:0:1');
    expect(canonicalIp('host')).toBeNull();
  });
});
