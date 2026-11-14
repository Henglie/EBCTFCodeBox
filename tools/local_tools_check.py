"""Offline verification only. Installation runners are fake; no pip/npm install executes."""
import http.client
import json
from pathlib import Path
import sys
import subprocess
import threading
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import local_tools as lt
import bridge

FIXTURES = ROOT / '资料/工程留存/MT751/fixtures'


def fake_service(runner=None):
    service = lt.LocalToolsService(runner=runner or lt.run_bounded)
    service.interpreters = {'py-test': {'id': 'py-test', 'path': sys.executable, 'version': '3.test', 'default': True}}
    service.nodes = {'node-test': 'enumerated-node'}
    service.discovered_at = time.monotonic()
    return service


class LocalToolsChecks(unittest.TestCase):
    def test_catalog_schema_and_boundaries(self):
        self.assertEqual(len(lt.CATALOG), 48)
        self.assertEqual(len(lt.BY_ID), 48)
        self.assertEqual({k: sum(i['kind'] == k for i in lt.CATALOG) for k in ['runtime', 'pip', 'npm']},
                         {'runtime': 7, 'pip': 27, 'npm': 14})
        for item in lt.CATALOG:
            self.assertTrue(item['url'].startswith('https://'))
            self.assertTrue(item['purposeEn'])
            self.assertIn(item['level'], ['common', 'intermediate'])
        self.assertNotIn('eval(', lt.PY_METADATA)
        self.assertNotIn('__import__', lt.PY_METADATA)

    def test_metadata_sentinels_not_executed(self):
        # The directory contains a hostile module, .pth and sitecustomize.
        directory = str(FIXTURES / 'metadata')
        script = lt.PY_METADATA.replace('out = {}', 'paths = ' + repr([directory]) + '\nout = {}')
        result = lt.run_bounded([sys.executable, '-I', '-S', '-c', script])
        self.assertTrue(result['ok'], result)
        self.assertEqual(json.loads(result['output'])['packages']['pycryptodome'], '9.8.7')
        info = lt.LocalToolsService._npm_metadata(FIXTURES / 'npm', '@noble/hashes')
        self.assertEqual(info['version'], '9.8.7')
        self.assertEqual(lt.LocalToolsService._npm_metadata(FIXTURES / 'npm', 'mathjs')['status'], 'missing')

    def test_fixed_plans_reject_injection(self):
        service = fake_service()
        for req in [
            {'id': 'sympy', 'pythonId': sys.executable},
            {'id': 'sympy;calc', 'pythonId': 'py-test'},
            {'id': 'python', 'pythonId': 'py-test'},
            {'id': 'sympy', 'pythonId': 'py-test', 'mirror': 'https://attacker.invalid'},
            {'id': 'sympy', 'pythonId': 'py-test', 'package': 'attacker'},
            {'id': 'sympy', 'pythonId': 'py-test', 'shell': 'calc'},
            {'id': 'sympy', 'pythonId': 'py-test', 'url': 'file:///etc/passwd'},
            {'id': 'sympy', 'pythonId': 'py-test', 'npmScope': 'managed'},
            {'id': 'noble-hashes', 'nodeId': 'node-test', 'npmScope': 'arbitrary'},
            {'id': True}, [], None,
        ]:
            with self.subTest(req=req), self.assertRaises(lt.LocalToolsError):
                service.plan(req)
        for mirror in lt.MIRRORS:
            plan = service.plan({'id': 'sympy', 'pythonId': 'py-test', 'mirror': mirror})
            self.assertEqual(plan['argv'][-1], 'sympy')
            self.assertIn('--only-binary=:all:', plan['argv'])
            self.assertIn(lt.MIRRORS[mirror]['pip'], plan['argv'])
            with patch.object(lt, '_npm_cli', return_value='fixed/npm-cli.js'):
                npm = service.plan({'id': 'noble-hashes', 'nodeId': 'node-test', 'mirror': mirror})
            self.assertEqual(npm['argv'][:2], ['enumerated-node', 'fixed/npm-cli.js'])
            self.assertIn('--ignore-scripts', npm['argv'])
            self.assertEqual(npm['argv'][-1], '@noble/hashes')

    def test_missing_multiple_environments_and_scope(self):
        service = fake_service()
        service.interpreters['py-other'] = {'id': 'py-other', 'path': 'enumerated-other', 'version': '3.other', 'default': False}
        def metadata(interpreter):
            return {'packages': {'sympy': '1.2.3', 'pip': '1'} if interpreter['id'] == 'py-test' else {}}
        with patch.object(service, '_python_metadata', side_effect=metadata), patch.object(service, '_runtimes', return_value={'sage': {'status': 'missing'}}):
            first = service.detect({'pythonId': 'py-test'})
            other = service.detect({'pythonId': 'py-other'})
            self.assertEqual(first['tools']['sympy']['version'], '1.2.3')
            self.assertEqual(other['tools']['sympy']['status'], 'missing')
            self.assertEqual(other['tools']['sage']['status'], 'missing')
            self.assertFalse(other['install']['pip'])
        with self.assertRaises(lt.LocalToolsError):
            service.detect({'pythonId': '/request/supplied/python'})
        with self.assertRaises(lt.LocalToolsError):
            service.detect({'npmScope': '/arbitrary/path'})
        with self.assertRaises(lt.LocalToolsError):
            service.dispatch('detect', [])
        with patch.object(service, '_discover'), patch.object(service, '_runtimes', return_value={}):
            service.interpreters = {}; service.nodes = {}; service.cache.clear()
            empty = service.detect({})
            self.assertEqual(empty['tools']['sympy']['status'], 'unavailable')
            self.assertFalse(empty['install']['pip'])

    def test_bounded_commands(self):
        timeout = lt.run_bounded([sys.executable, '-I', '-S', '-c', 'import time;time.sleep(2)'], timeout=.15)
        self.assertEqual(timeout['reason'], 'timeout')
        overflow = lt.run_bounded([sys.executable, '-I', '-S', '-c', 'print("x" * 4096)'], budget=1024)
        self.assertEqual(overflow['reason'], 'output_limit')
        self.assertLessEqual(len(overflow['output'].encode()), 1024)
        event = threading.Event()
        threading.Timer(.1, event.set).start()
        cancelled = lt.run_bounded([sys.executable, '-I', '-S', '-c', 'import time;time.sleep(2)'], cancel=event)
        self.assertEqual(cancelled['reason'], 'cancelled')

    def test_fake_install_success_failure_readonly_cancel(self):
        for result, expected in [({'ok': True, 'reason': '', 'exitCode': 0}, 'succeeded'),
                                 ({'ok': False, 'reason': '', 'exitCode': 1}, 'failed'),
                                 ({'ok': False, 'reason': 'timeout', 'exitCode': -1}, 'failed'),
                                 ({'ok': False, 'reason': 'output_limit', 'exitCode': -1}, 'failed')]:
            def runner(argv, **kwargs):
                self.assertIn('-m', argv)
                kwargs['on_chunk']('SIMULATED ONLY\n')
                return result
            service = fake_service(runner)
            job = service.start({'id': 'sympy', 'pythonId': 'py-test'})['job']
            for _ in range(100):
                job = service.job({'jobId': job['jobId']})['job']
                if job['state'] != 'running': break
                time.sleep(.01)
            self.assertEqual(job['state'], expected)
            self.assertEqual(job['log'], 'SIMULATED ONLY\n')
        def denied(*args, **kwargs):
            raise PermissionError('read-only environment (fake)')
        service = fake_service(denied)
        job = service.start({'id': 'sympy', 'pythonId': 'py-test'})['job']
        time.sleep(.05)
        self.assertEqual(service.job({'jobId': job['jobId']})['job']['state'], 'failed')
        def wait_runner(argv, **kwargs):
            self.assertTrue(kwargs['cancel'].wait(2))
            return {'ok': False, 'reason': 'cancelled', 'exitCode': -1}
        service = fake_service(wait_runner)
        job = service.start({'id': 'sympy', 'pythonId': 'py-test'})['job']
        with self.assertRaises(lt.LocalToolsError): service.start({'id': 'sympy', 'pythonId': 'py-test'})
        service.cancel({'jobId': job['jobId']})
        time.sleep(.05)
        self.assertEqual(service.job({'jobId': job['jobId']})['job']['state'], 'cancelled')
        with self.assertRaises(lt.LocalToolsError): service.job({'jobId': '../anything'})

    def test_http_origin_host_content_type_and_limits(self):
        class Handler(bridge.BridgeHandler):
            def log_message(self, *args): pass
        httpd = bridge.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        def request(body='{}', origin='http://127.0.0.1:8180', content_type='application/json', host=None, path='plan'):
            conn = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=10)
            headers = {'Content-Type': content_type, 'Origin': origin}
            if host: headers['Host'] = host
            conn.request('POST', '/api/local-tools/' + path, body=body, headers=headers)
            response = conn.getresponse(); status = response.status; payload = json.loads(response.read()); conn.close()
            return status, payload
        try:
            with patch.object(bridge, 'LOCAL_TOOLS', fake_service()):
                self.assertEqual(request(origin='https://attacker.invalid')[0], 403)
                self.assertEqual(request(origin='null')[0], 403)
                self.assertEqual(request(host='attacker.invalid')[0], 403)
                self.assertEqual(request(content_type='text/plain')[0], 415)
                self.assertEqual(request(body='x' * 4097)[0], 413)
                self.assertEqual(request(body='[')[0], 400)
                self.assertEqual(request(body='[]')[0], 400)
                self.assertEqual(request(path='shell')[0], 404)
                code, payload = request(body=json.dumps({'id': 'sympy', 'pythonId': 'py-test'}))
                self.assertEqual(code, 200)
                self.assertEqual(payload['schema'], 1)
                self.assertIn('--only-binary=:all:', payload['argv'])
        finally:
            httpd.shutdown(); httpd.server_close(); thread.join(2)

    def test_native_stdio_delegate(self):
        requests = [
            {'requestId': 'one', 'action': 'detect', 'payload': {}},
            {'requestId': 'two', 'action': 'plan', 'payload': {'id': 'sympy', 'pythonId': '/arbitrary/python'}},
            {'requestId': 'three', 'action': 'shell', 'payload': {}},
        ]
        result = subprocess.run([sys.executable, '-I', '-S', '-B', '-u', str(ROOT / 'local_tools.py'), '--stdio'],
                                input=''.join(json.dumps(value) + '\n' for value in requests),
                                capture_output=True, text=True, encoding='utf-8', timeout=90, shell=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(lines), 3)
        self.assertEqual(lines[0]['requestId'], 'one')
        self.assertEqual(lines[0]['status'], 200)
        self.assertEqual(lines[0]['catalogCount'], 48)
        self.assertEqual(lines[1]['status'], 400)
        self.assertEqual(lines[2]['status'], 404)

    def test_real_npm_empty_config_without_install(self):
        nodes = lt._node_candidates()
        self.assertTrue(nodes, 'Local verification requires installed Node')
        node = nodes[0]
        cli = lt._npm_cli(node)
        self.assertTrue(cli)
        service = fake_service()
        service.nodes = {'node-test': node}
        plan = service.plan({'id': 'noble-hashes', 'nodeId': 'node-test'})
        config_flags = [arg for arg in plan['argv'] if arg.startswith(('--userconfig=', '--globalconfig=', '--registry='))]
        self.assertEqual(len(config_flags), 3)
        result = lt.run_bounded([node, cli, 'config', 'get', 'registry', *config_flags])
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['output'].strip().rstrip('/'), lt.MIRRORS['default']['npm'].rstrip('/'))

    def test_real_local_metadata_only(self):
        service = lt.LocalToolsService()
        data = service.detect()
        self.assertEqual(len(data['tools']), 48)
        self.assertEqual(data['tools']['python']['status'], 'installed')
        rows = []
        for interpreter in data['interpreters']:
            result = service.detect({'pythonId': interpreter['id']})
            rows.append({'id': interpreter['id'], 'version': interpreter['version'],
                         'installedPip': sum(result['tools'][i['id']]['status'] == 'installed' for i in lt.CATALOG if i['kind'] == 'pip'),
                         'sympy': result['tools']['sympy'], 'sage': result['tools']['sage']['status']})
        print('LOCAL_METADATA=' + json.dumps({'interpreters': rows,
              'defaultTools': {k: {f: v for f, v in value.items() if f != 'path'} for k, value in data['tools'].items()}}, ensure_ascii=True))
        service.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
