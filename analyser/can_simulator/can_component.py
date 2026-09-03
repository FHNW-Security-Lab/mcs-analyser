from pathlib import Path

from analyser.common import Config, logger
log = logger(__name__)

class Component:

    def __init__(self, name: str, path: 'Path', description: str = "",
                 metadata: dict = None):
        """
        A `Component` references a binary and holds some metadata needed during analysis.

        Metadata:
            `max_expected_inputs`: Tracks of how many inputs this `Component` might consume.
            This is useful to determine if enough `Messages` are available to analyse this `Component`.

            `is_analysed`: Simple flag indicating whether this `Component` has been analysed.

            `consumed_ids`: Set of `Message` ids that this `Component` can consume during analysis.

            `produced_ids`: Set of `Message` ids that this `Component` can produce during analysis.

        :param name: The display name of the `Component`.
        :param path: The location of the binary of this `Component`.
        """
        self.name = name
        self.path = path
        self.description = description
        self.metadata = dict(metadata or {})
        self.component_id = self.metadata.get('id', name)
        self.max_expected_inputs = 0
        self.is_analysed = False
        self.consumed_ids: set[int] = set()
        self.produced_ids: set[int] = set()


    def update_max_expected_inputs(self, number_of_inputs: int):
        """
        Helper method to update the `max_expected_inputs` attribute of the `Component`.
        :param number_of_inputs:
        :return:
        """
        if number_of_inputs > self.max_expected_inputs:
            self.max_expected_inputs = number_of_inputs


    def reset_max_expected_inputs(self):
        """
        Helper method to reset the `max_expected_inputs` attribute of the `Component`.
        :return:
        """
        self.max_expected_inputs = 0


    def add_subscription(self, subscription: int):
        """
        Helper method to add a subscription to the `Component`.
        :param subscription:
        :return:
        """
        if subscription not in self.consumed_ids:
            subscription_str = Config.message_name_lookup.get(subscription, str(subscription))
            log.info(f"{self} can read messages of type {[subscription_str]} (0x{subscription:x})")
            self.consumed_ids.add(subscription)

    def add_production(self, production: int):
        """
        Helper method to add a production to the `Component`.
        :param production:
        :return:
        """
        if production not in self.produced_ids:
            produced_msg_type_str = Config.message_name_lookup.get(production, str(production))
            log.info(f"{self} can produce messages of type {[produced_msg_type_str]} (0x{production:x}) messages")
            self.produced_ids.add(production)


    def __repr__(self):
        return f'{[self.name]}'


    def __str__(self):
        return f'{[self.name]}'
