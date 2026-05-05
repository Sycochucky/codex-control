import asyncio
import unittest

from app.app_server.manager import CodexAppServerManager


class FakeProcess:
    def __init__(self, wait_forever: bool) -> None:
        self.returncode = None
        self.terminate_called = False
        self.kill_called = False
        self._wait_forever = wait_forever

    def terminate(self) -> None:
        self.terminate_called = True
        if not self._wait_forever:
            self.returncode = 0

    def kill(self) -> None:
        self.kill_called = True
        self.returncode = -9

    async def wait(self) -> None:
        if self.returncode is not None:
            return

        if self._wait_forever:
            await asyncio.sleep(60)
            return

        return


class CodexAppServerManagerTests(unittest.IsolatedAsyncioTestCase):
    async def test_stop_process_kills_stalled_recycle(self) -> None:
        manager = CodexAppServerManager()
        process = FakeProcess(wait_forever=True)
        manager._process = process

        await manager._stop_process(timeout_seconds=0.01)

        self.assertTrue(process.terminate_called)
        self.assertTrue(process.kill_called)
        self.assertIsNone(manager._process)

    async def test_stop_process_does_not_kill_clean_recycle(self) -> None:
        manager = CodexAppServerManager()
        process = FakeProcess(wait_forever=False)
        manager._process = process

        await manager._stop_process(timeout_seconds=0.01)

        self.assertTrue(process.terminate_called)
        self.assertFalse(process.kill_called)
        self.assertIsNone(manager._process)


if __name__ == "__main__":
    unittest.main()
