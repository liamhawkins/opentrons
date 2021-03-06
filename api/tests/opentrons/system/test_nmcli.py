import pytest  # noqa

from opentrons.system import nmcli


def test_sanitize_args():
    cmd = ['nmcli',
           'connection', 'add', 'wifi.ssid', 'Opentrons',
           'wifi-sec.psk', 'test-password',
           'wifi-sec.key-mgmt', 'wpa2-psk']
    sanitized = nmcli.sanitize_args(cmd)
    # Check preconditions
    assert 'test-password' in cmd
    # Check output
    assert 'test-password' not in sanitized

    cmd2 = ['nmcli',
            'connection', 'modify',
            '+wifi-sec.psk', 'test-password']
    sanitized = nmcli.sanitize_args(cmd2)
    assert 'test-password' in cmd2
    assert 'test-password' not in sanitized


def test_output_transformations():
    fields = ['name', 'type', 'autorun', 'active', 'iface', 'state']
    should_have = [['static-eth0',
                    '802-3-ethernet',
                    'yes', 'yes', 'eth0', 'activated'],
                   ['wifi-wlan0',
                    '802-11-wireless',
                    'yes', 'no', 'wlan0', '--']]
    # This test input is taken from the result of
    # nmcli -t -f name,type,autoconnect,active,device,state connection show
    test_input = '''static-eth0:802-3-ethernet:yes:yes:eth0:activated
wifi-wlan0:802-11-wireless:yes:no:wlan0:--
'''
    # No transforms: correctly parse fields
    split = nmcli._dict_from_terse_tabular(fields, test_input)
    assert len(split) == 2
    for outp in zip(split, should_have):
        # All fields, in order, should be in the output
        assert fields == list(outp[0].keys())
        assert outp[1] == list(outp[0].values())

    # Transforms for some but not all keys
    transforms = {'name': lambda s: s.upper(),
                  'active': lambda s: s == 'yes'}
    split = nmcli._dict_from_terse_tabular(fields, test_input, transforms)
    assert split[0]['name'] == should_have[0][0].upper()
    assert split[1]['name'] == should_have[1][0].upper()
    assert split[0]['active'] is True
    assert split[1]['active'] is False


async def test_available_ssids(monkeypatch):
    mock_nmcli_output = '''mock_wpa2:90:no:WPA2
mock_no_security:80:no:
mock_enterprise:70:no:WPA1 WPA2 802.1X
mock_connected:60:yes:WPA2
mock_bad_security:50:no:foobar
--:40:no:'''

    expected_cmd = ['--terse', '--fields',
                    'ssid,signal,active,security', 'device', 'wifi', 'list']

    expected = [
        {'ssid': 'mock_wpa2', 'signal': 90, 'active': False,
            'security': 'WPA2', 'securityType': 'wpa-psk'},
        {'ssid': 'mock_no_security', 'signal': 80, 'active': False,
            'security': '', 'securityType': 'none'},
        {'ssid': 'mock_enterprise', 'signal': 70, 'active': False,
            'security': 'WPA1 WPA2 802.1X', 'securityType': 'wpa-eap'},
        {'ssid': 'mock_connected', 'signal': 60, 'active': True,
            'security': 'WPA2', 'securityType': 'wpa-psk'},
        {'ssid': 'mock_bad_security', 'signal': 50, 'active': False,
            'security': 'foobar', 'securityType': 'unsupported'}
        # note entry for 'ssid': '--' is expected to be filterd out
    ]

    async def mock_call(cmd):
        assert cmd == expected_cmd
        return mock_nmcli_output, ''

    monkeypatch.setattr(nmcli, '_call', mock_call)
    result = await nmcli.available_ssids()
    assert result == expected
