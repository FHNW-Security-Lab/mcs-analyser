class Config:
    """
    A container to store the values read from the config file.
    """
    default_var_length: int = 0
    input_hooks: list[str] = []
    output_hooks: list[str] = []
    msg_id_prefix: str = 'MSG_'
    message_name_lookup: dict[int, str] = {}
    source_path = None
    source_data: dict = {}
    _initialized = False

    @classmethod
    def init(cls, default_var_length: int = 0, input_hooks: list[str] = None,
             output_hooks: list[str] = None, msg_id_prefix = None,
             message_name_lookup: dict[int, str] = None, source_path=None,
             source_data: dict = None):
        cls.default_var_length = default_var_length
        cls.input_hooks = input_hooks or []
        cls.output_hooks = output_hooks or []
        cls.msg_id_prefix = msg_id_prefix or 'MSG_'
        cls.message_name_lookup = message_name_lookup or dict()
        cls.source_path = source_path
        cls.source_data = source_data or {}
        cls._initialized = True

    @classmethod
    def reset(cls):
        """Reset all process-global configuration state between analysis runs."""
        cls.default_var_length = 0
        cls.input_hooks = []
        cls.output_hooks = []
        cls.msg_id_prefix = 'MSG_'
        cls.message_name_lookup = {}
        cls.source_path = None
        cls.source_data = {}
        cls._initialized = False
