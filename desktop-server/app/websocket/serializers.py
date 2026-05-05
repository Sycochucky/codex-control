from app.models.entities import Message, TaskEvent, TaskRun


def serialize_message_created(message: Message) -> dict:
    return {
        "type": "message_created",
        "thread_id": message.thread_id,
        "message": {
            "id": message.id,
            "role": message.role,
            "content": message.content,
            "created_at": message.created_at,
            "updated_at": message.updated_at,
        },
    }


def serialize_task_event_created(task_event: TaskEvent, thread_id: str) -> dict:
    return {
        "type": "task_event_created",
        "thread_id": thread_id,
        "task_event": {
            "id": task_event.id,
            "task_run_id": task_event.task_run_id,
            "event_type": task_event.event_type,
            "content": task_event.content,
            "created_at": task_event.created_at,
            "updated_at": task_event.updated_at,
        },
    }


def serialize_task_updated(task_run: TaskRun) -> dict:
    return {
        "type": "task_updated",
        "thread_id": task_run.thread_id,
        "task": {
            "id": task_run.id,
            "thread_id": task_run.thread_id,
            "status": task_run.status,
            "provider_name": task_run.provider_name,
            "created_at": task_run.created_at,
            "updated_at": task_run.updated_at,
            "completed_at": task_run.completed_at,
        },
    }
